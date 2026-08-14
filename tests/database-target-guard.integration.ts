import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import postgres from 'postgres';
import { validateTestDatabaseUrl } from '../lib/db/test-database-url.ts';
import { runIntegrationDatabase } from '../scripts/run-integration-db.ts';

const safeUrl = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL).toString();
const sql = postgres(safeUrl, { max: 1 });

before(async () => {
  await sql.unsafe('create schema if not exists destructive_guard_sentinel');
  await sql.unsafe('create table if not exists destructive_guard_sentinel.records (id integer primary key, value text not null)');
  await sql.unsafe("insert into destructive_guard_sentinel.records(id,value) values(1,'must survive') on conflict(id) do update set value=excluded.value");
});
after(async () => { await sql.unsafe('drop schema if exists destructive_guard_sentinel cascade'); await sql.end(); });

async function assertRejectedWithoutMutation(testUrl: string | undefined, productionUrl?: string) {
  let destructiveSuiteEntered = false;
  await assert.rejects(runIntegrationDatabase(
    { NODE_ENV: 'test', TEST_DATABASE_URL: testUrl, POSTGRES_URL: productionUrl },
    async () => {
      destructiveSuiteEntered = true;
      await sql.unsafe('drop schema destructive_guard_sentinel cascade');
    }
  ));
  assert.equal(destructiveSuiteEntered, false, 'destructive suite must not start before destination validation');
  assert.deepEqual([...(await sql`select id,value from destructive_guard_sentinel.records`)], [{ id: 1, value: 'must survive' }]);
}

test('rejected database destinations preserve real sentinel schema, table, and row data', async () => {
  const rejected = [
    '   ', 'not-a-url', 'postgres://', 'mysql://u:p@localhost/idoc_test', 'file:///idoc_test',
    'postgres://localhost/idoc_test', 'postgres://u:p@localhost/', 'postgres://u:p@localhost/latest',
    'postgres://u:p@localhost/customer_idoc_test_backup', 'postgres://u:p@localhost/idoc_testproduction',
    'postgres://u:p@localhost/production', 'postgres://u:p@production-db/idoc_test',
    'postgres://u:p@service.onrender.com/idoc_test', 'postgres://u:p@example.render.com/idoc_test',
    'postgres://u:p@contest-db.example/idoc_test', 'postgres://u:p@localhost/not_idoc_test_safe',
    'postgres://u:p@localhost/idoc%252Ftest', 'postgres://u:p@localhost/idoc%5Ftest%2Fother',
  ];
  for (const value of rejected) await assertRejectedWithoutMutation(value);

  assert.throws(() => validateTestDatabaseUrl(undefined), /explicitly supplied/);
  assert.deepEqual([...(await sql`select id,value from destructive_guard_sentinel.records`)], [{ id: 1, value: 'must survive' }]);
});

test('equivalent destination decoration cannot bypass validation before destructive SQL', async () => {
  const production = 'postgresql://production:secret@localhost:5432/idoc_test?application_name=prod&sslmode=require';
  const aliases = [
    'postgres://other:credentials@LOCALHOST/idoc_test',
    'postgresql://u:p@localhost/idoc_test?sslmode=disable',
    'postgres://u:p@localhost:5432/idoc%5Ftest?b=2&a=1#ignored',
    'postgres://percent%40user:percent%3Apass@localhost/idoc_test?ssl=true',
    'postgres://u:p@localhost:5432/idoc_test?application_name=test&sslmode=prefer',
  ];
  for (const value of aliases) await assertRejectedWithoutMutation(value, production);

  const ipv6Production = 'postgresql://production:secret@[::1]:5432/idoc_test?sslmode=require';
  for (const value of ['postgres://other:other@[::1]/idoc_test', 'postgresql://u:p@[::1]:5432/idoc%5Ftest#fragment']) {
    await assertRejectedWithoutMutation(value, ipv6Production);
  }
});
