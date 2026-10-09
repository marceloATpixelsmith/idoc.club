\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
    item record;
    app_role text;
    opposite_schema text;
    relation_name text;
BEGIN
    FOR item IN
        SELECT * FROM (VALUES
            ('idoc_production','idoc_production_app','idoc_staging'),
            ('idoc_staging','idoc_staging_app','idoc_production')
        ) AS t(schema_name,login_role,other_schema)
    LOOP
        app_role:=item.login_role;
        opposite_schema:=item.other_schema;

        IF NOT EXISTS (
            SELECT 1 FROM pg_roles
            WHERE rolname=app_role AND rolcanlogin AND NOT rolsuper
              AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls
              AND NOT rolinherit
        ) THEN
            RAISE EXCEPTION 'Unexpected PostgreSQL login privileges for %', app_role;
        END IF;

        IF EXISTS (
            SELECT 1 FROM pg_auth_members m
            JOIN pg_roles member ON member.oid=m.member
            WHERE member.rolname=app_role
        ) THEN
            RAISE EXCEPTION 'Application login % has unexpected role memberships', app_role;
        END IF;

        IF NOT has_schema_privilege(app_role,item.schema_name,'USAGE')
           OR has_schema_privilege(app_role,opposite_schema,'USAGE')
           OR has_schema_privilege(app_role,item.schema_name,'CREATE') THEN
            RAISE EXCEPTION 'Schema privileges violate isolation for %', app_role;
        END IF;

        FOR relation_name IN
            SELECT c.relname
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=item.schema_name AND c.relkind IN ('r','p')
        LOOP
            IF NOT has_table_privilege(app_role,format('%I.%I',item.schema_name,relation_name),'SELECT,INSERT,UPDATE,DELETE') THEN
                RAISE EXCEPTION 'Application login % cannot manage own table %',app_role,relation_name;
            END IF;

            IF has_table_privilege(
                (CASE WHEN app_role='idoc_staging_app' THEN 'idoc_production_app' ELSE 'idoc_staging_app' END),
                format('%I.%I',item.schema_name,relation_name),
                'SELECT'
            ) THEN
                RAISE EXCEPTION 'Opposite environment has table privileges on %.%',item.schema_name,relation_name;
            END IF;
        END LOOP;
    END LOOP;
END $$;

ROLLBACK;

\echo 'Database-role isolation checks passed.'
