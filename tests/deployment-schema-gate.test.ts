import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const gate = 'scripts/assert-deployment-schema-ready.mjs';

test('deployment build checks database migration readiness before Next.js build', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.equal(config.buildCommand, 'node scripts/assert-deployment-schema-ready.mjs && pnpm build');
  const source = readFileSync(gate, 'utf8');
  for (const signal of ['__drizzle_migrations', 'email_delivery_log', 'email_delivery_events',
    'email_delivery_pending_events', 'operational_alert_outbox']) {
    assert.ok(source.includes(signal), `Missing deployment readiness check for ${signal}`);
  }
  assert.match(source, /target === null/);
  assert.match(source, /actual !== expected/);
  assert.doesNotMatch(source, /db:migrate|migrate\(/);
});

test('deployment gate refuses schema mismatches before opening any database connection', () => {
  const run = spawnSync(process.execPath, [gate], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: 'main',
      DB_SCHEMA: 'idoc_staging',
      POSTGRES_URL: 'postgres://idoc_production_app:fake@localhost:5432/idoc',
    },
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /expected DB_SCHEMA=idoc_production/);
});

test('non-deployment test builds require no live database credentials', () => {
  const env = { ...process.env };
  delete env.VERCEL_ENV;
  delete env.DB_SCHEMA;
  delete env.POSTGRES_URL;
  const run = spawnSync(process.execPath, [gate], { cwd: process.cwd(), encoding: 'utf8', env });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /skipped/);
});
