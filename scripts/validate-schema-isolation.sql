\set ON_ERROR_STOP on
BEGIN;

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
SELECT 'staging_unconsumed_token','mfa_recovery_codes','0',count(*)::text
FROM idoc_staging.mfa_recovery_codes WHERE consumed_at IS NULL
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


WITH production AS (
  SELECT c.relname, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='idoc_production' AND c.relkind IN ('r','p','S','v','m')
), staging AS (
  SELECT c.relname, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='idoc_staging' AND c.relkind IN ('r','p','S','v','m')
)
INSERT INTO schema_isolation_validation
SELECT 'relation_inventory',coalesce(p.relname,s.relname),
       CASE WHEN p.relname IS NULL THEN 'missing' ELSE p.relkind::text END,
       CASE WHEN s.relname IS NULL THEN 'missing' ELSE s.relkind::text END
FROM production p FULL JOIN staging s USING (relname)
WHERE p.relname IS NULL OR s.relname IS NULL OR p.relkind<>s.relkind;

WITH production AS (
  SELECT c.relname, pg_get_userbyid(c.relowner) AS owner_name, replace(coalesce(c.relacl::text,''), 'idoc_production_app','<app_role>') AS acl
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='idoc_production' AND c.relkind IN ('r','p','S','v','m')
), staging AS (
  SELECT c.relname, pg_get_userbyid(c.relowner) AS owner_name, replace(coalesce(c.relacl::text,''), 'idoc_staging_app','<app_role>') AS acl
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='idoc_staging' AND c.relkind IN ('r','p','S','v','m')
)
INSERT INTO schema_isolation_validation
SELECT 'relation_permissions',coalesce(p.relname,s.relname),
       coalesce(p.owner_name||'|'||p.acl,'missing'),coalesce(s.owner_name||'|'||s.acl,'missing')
FROM production p FULL JOIN staging s USING (relname)
WHERE p.owner_name IS DISTINCT FROM s.owner_name OR p.acl IS DISTINCT FROM s.acl;

WITH resolved AS (
  SELECT d.*,
    CASE d.classid
      WHEN 'pg_class'::regclass THEN (SELECT relnamespace FROM pg_class WHERE oid=d.objid)
      WHEN 'pg_proc'::regclass THEN (SELECT pronamespace FROM pg_proc WHERE oid=d.objid)
      WHEN 'pg_constraint'::regclass THEN (SELECT connamespace FROM pg_constraint WHERE oid=d.objid)
      WHEN 'pg_rewrite'::regclass THEN (SELECT c.relnamespace FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class WHERE r.oid=d.objid)
      WHEN 'pg_trigger'::regclass THEN (SELECT c.relnamespace FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.oid=d.objid)
      WHEN 'pg_type'::regclass THEN (SELECT typnamespace FROM pg_type WHERE oid=d.objid)
      WHEN 'pg_namespace'::regclass THEN d.objid
      ELSE NULL
    END AS source_namespace_oid,
    CASE d.refclassid
      WHEN 'pg_class'::regclass THEN (SELECT relnamespace FROM pg_class WHERE oid=d.refobjid)
      WHEN 'pg_proc'::regclass THEN (SELECT pronamespace FROM pg_proc WHERE oid=d.refobjid)
      WHEN 'pg_constraint'::regclass THEN (SELECT connamespace FROM pg_constraint WHERE oid=d.refobjid)
      WHEN 'pg_rewrite'::regclass THEN (SELECT c.relnamespace FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class WHERE r.oid=d.refobjid)
      WHEN 'pg_trigger'::regclass THEN (SELECT c.relnamespace FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.oid=d.refobjid)
      WHEN 'pg_type'::regclass THEN (SELECT typnamespace FROM pg_type WHERE oid=d.refobjid)
      WHEN 'pg_namespace'::regclass THEN d.refobjid
      ELSE NULL
    END AS target_namespace_oid
  FROM pg_depend d
), cross_schema AS (
  SELECT source_ns.nspname AS source_schema, target_ns.nspname AS target_schema, count(*)::int AS references
  FROM resolved r
  JOIN pg_namespace source_ns ON source_ns.oid=r.source_namespace_oid
  JOIN pg_namespace target_ns ON target_ns.oid=r.target_namespace_oid
  WHERE source_ns.nspname IN ('idoc_production','idoc_staging')
    AND target_ns.nspname IN ('idoc_production','idoc_staging')
    AND source_ns.nspname<>target_ns.nspname
  GROUP BY source_ns.nspname,target_ns.nspname
)
INSERT INTO schema_isolation_validation
SELECT 'cross_schema_dependency',source_schema||'->'||target_schema,'0',references::text
FROM cross_schema
WHERE references<>0;

INSERT INTO schema_isolation_validation
SELECT 'function_text_cross_schema',n.nspname||'.'||p.proname,'none','cross-schema text reference'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('idoc_production','idoc_staging')
  AND (
    (n.nspname='idoc_staging' AND
      (position('idoc_production.' in pg_get_functiondef(p.oid))>0 OR position('"idoc_production".' in pg_get_functiondef(p.oid))>0))
    OR
    (n.nspname='idoc_production' AND
      (position('idoc_staging.' in pg_get_functiondef(p.oid))>0 OR position('"idoc_staging".' in pg_get_functiondef(p.oid))>0))
    OR position('"idoc".' in pg_get_functiondef(p.oid))>0
  );

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
