\set ON_ERROR_STOP on
CREATE TEMP TABLE schema_isolation_inventory (
  object_type text NOT NULL,
  object_name text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  item record;
  row_count bigint;
  seq_value bigint;
BEGIN
  FOR item IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=:'inventory_schema' AND c.relkind IN ('r','p')
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', :'inventory_schema', item.relname) INTO row_count;
    INSERT INTO schema_isolation_inventory VALUES ('table', item.relname, row_count::text);
  END LOOP;

  FOR item IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=:'inventory_schema' AND c.relkind='S'
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT last_value FROM %I.%I', :'inventory_schema', item.relname) INTO seq_value;
    INSERT INTO schema_isolation_inventory VALUES ('sequence', item.relname, seq_value::text);
  END LOOP;
END $$;

INSERT INTO schema_isolation_inventory
SELECT 'constraint', conname, contype::text
FROM pg_constraint c
JOIN pg_namespace n ON n.oid=c.connamespace
WHERE n.nspname=:'inventory_schema';

INSERT INTO schema_isolation_inventory
SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', p.prokind::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname=:'inventory_schema';

INSERT INTO schema_isolation_inventory
SELECT 'trigger', c.relname || '.' || t.tgname, t.tgenabled::text
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname=:'inventory_schema' AND NOT t.tgisinternal;

SELECT object_type || '|' || object_name || '|' || detail
FROM schema_isolation_inventory
ORDER BY object_type, object_name, detail;
