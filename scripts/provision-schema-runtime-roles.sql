\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    current_owner text := current_user;
    schema_name text;
    app_role text;
BEGIN
    FOR schema_name IN
        SELECT unnest(ARRAY['idoc_production', 'idoc_staging'])
    LOOP
        IF to_regnamespace(schema_name) IS NULL THEN
            RAISE EXCEPTION 'Missing schema: %', schema_name;
        END IF;

        IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname=schema_name) <> current_owner THEN
            RAISE EXCEPTION 'Cutover executor must own schema %', schema_name;
        END IF;
    END LOOP;

    IF NOT (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) THEN
        RAISE EXCEPTION 'Cutover executor cannot create isolated database login roles';
    END IF;

    FOREACH app_role IN ARRAY ARRAY['idoc_production_app', 'idoc_staging_app']
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=app_role) THEN
            EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT PASSWORD NULL',app_role);
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_roles
            WHERE rolname=app_role AND rolcanlogin AND NOT rolsuper
              AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls
        ) THEN
            RAISE EXCEPTION 'Existing role % has unexpected privileges',app_role;
        END IF;

        IF EXISTS (
            SELECT 1 FROM pg_auth_members m
            JOIN pg_roles member ON member.oid=m.member
            WHERE member.rolname=app_role
        ) THEN
            RAISE EXCEPTION 'Role % must not inherit privileges from any parent roles',app_role;
        END IF;
    END LOOP;
END $$;

REVOKE ALL ON SCHEMA idoc_production FROM PUBLIC, idoc_staging_app;
REVOKE ALL ON SCHEMA idoc_staging FROM PUBLIC, idoc_production_app;

REVOKE ALL ON ALL TABLES IN SCHEMA idoc_production FROM PUBLIC, idoc_staging_app;
REVOKE ALL ON ALL TABLES IN SCHEMA idoc_staging FROM PUBLIC, idoc_production_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA idoc_production FROM PUBLIC, idoc_staging_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA idoc_staging FROM PUBLIC, idoc_production_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA idoc_production FROM PUBLIC, idoc_staging_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA idoc_staging FROM PUBLIC, idoc_production_app;

GRANT CONNECT ON DATABASE ayni_space TO idoc_production_app, idoc_staging_app;

ALTER ROLE idoc_production_app SET search_path = idoc_production, pg_catalog;
ALTER ROLE idoc_staging_app SET search_path = idoc_staging, pg_catalog;

GRANT USAGE ON SCHEMA idoc_production TO idoc_production_app;
GRANT USAGE ON SCHEMA idoc_staging TO idoc_staging_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA idoc_production TO idoc_production_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA idoc_staging TO idoc_staging_app;

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA idoc_production TO idoc_production_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA idoc_staging TO idoc_staging_app;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA idoc_production TO idoc_production_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA idoc_staging TO idoc_staging_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA idoc_production
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO idoc_production_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA idoc_staging
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO idoc_staging_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA idoc_production
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO idoc_production_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA idoc_staging
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO idoc_staging_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA idoc_production
GRANT EXECUTE ON FUNCTIONS TO idoc_production_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA idoc_staging
GRANT EXECUTE ON FUNCTIONS TO idoc_staging_app;

DO $$
BEGIN
    IF has_schema_privilege('idoc_staging_app','idoc_production','USAGE')
       OR has_schema_privilege('idoc_production_app','idoc_staging','USAGE') THEN
        RAISE EXCEPTION 'Schema access boundary failed';
    END IF;

    IF has_table_privilege('idoc_staging_app','idoc_production.users','SELECT')
       OR has_table_privilege('idoc_staging_app','idoc_production.users','UPDATE')
       OR has_table_privilege('idoc_production_app','idoc_staging.users','SELECT')
       OR has_table_privilege('idoc_production_app','idoc_staging.users','UPDATE') THEN
        RAISE EXCEPTION 'Cross-environment table privilege detected';
    END IF;

    IF NOT has_schema_privilege('idoc_staging_app','idoc_staging','USAGE')
       OR NOT has_schema_privilege('idoc_production_app','idoc_production','USAGE')
       OR NOT has_table_privilege('idoc_staging_app','idoc_staging.users','SELECT')
       OR NOT has_table_privilege('idoc_production_app','idoc_production.users','SELECT') THEN
        RAISE EXCEPTION 'Application role is missing its own schema privileges';
    END IF;
END $$;

COMMIT;

\echo 'Application roles provisioned with no passwords. Set unique passwords using a secure PostgreSQL client before configuring Vercel POSTGRES_URL.'
