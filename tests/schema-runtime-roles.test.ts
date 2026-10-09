import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const connection = readFileSync('lib/db/connection-url.ts', 'utf8');
const selector = readFileSync('lib/db/schema-name.ts', 'utf8');
const provision = readFileSync('scripts/provision-schema-runtime-roles.sql', 'utf8');
const verification = readFileSync('scripts/verify-schema-runtime-roles.sql', 'utf8');
const cutover = readFileSync('scripts/schema-isolation-cutover.sh', 'utf8');

test('production and staging deployments demand distinct PostgreSQL login names', () =>
{
  assert.match(connection, /idoc_production_app/);
  assert.match(connection, /idoc_staging_app/);
  assert.match(connection, /decodeURIComponent\(parsedUrl\.username\) !== requiredLogin/);
});

test('arbitrary Preview branches cannot claim the staging schema', () =>
{
  assert.match(selector, /VERCEL_GIT_COMMIT_REF !== 'staging'/);
  assert.match(selector, /Only the staging branch may use idoc_staging/);
});

test('database grants deny each environment access to the other schema', () =>
{
  assert.match(provision, /CREATE ROLE %I LOGIN NOINHERIT PASSWORD NULL/);
  assert.match(provision, /REVOKE ALL ON SCHEMA idoc_production FROM PUBLIC, idoc_staging_app/);
  assert.match(provision, /REVOKE ALL ON SCHEMA idoc_staging FROM PUBLIC, idoc_production_app/);
  assert.match(provision, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA idoc_production TO idoc_production_app/);
  assert.match(provision, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA idoc_staging TO idoc_staging_app/);
  assert.match(verification, /has_schema_privilege\(app_role,opposite_schema,'USAGE'\)/);
  assert.match(cutover, /verify-schema-runtime-roles\.sql/);
});

test('the coordinated cutover is confined to the known Render application database', () =>
{
  assert.match(cutover, /Refusing schema operations outside ayni_space/);
  assert.match(cutover, /SCHEMA_ISOLATION_CONFIRM/);
});
