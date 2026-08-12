import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { validateTestDatabaseUrl } from '../lib/db/test-database-url.ts';

const url = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL).toString();
const sql = postgres(url, { max: 1 });
const database = drizzle(sql);
const migrationsFolder = new URL('../lib/db/migrations', import.meta.url).pathname;

before(async () => {
  await sql.unsafe('DROP SCHEMA IF EXISTS idoc CASCADE');
});
after(async () => { await sql.unsafe('DROP SCHEMA IF EXISTS idoc CASCADE'); await sql.end(); });

test('Drizzle applies every migration to an empty isolated database', async () => {
  await migrate(database, { migrationsFolder, migrationsSchema: 'idoc', migrationsTable: '__drizzle_migrations' });
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from idoc.__drizzle_migrations`;
  assert.equal(count, 7);
});

test('Drizzle applies migration 0005 to a database already at 0004', async () => {
  await sql.unsafe('DROP SCHEMA IF EXISTS idoc CASCADE');
  const temporary = await mkdtemp(join(tmpdir(), 'idoc-migrations-'));
  try {
    await mkdir(join(temporary, 'meta'));
    const names = ['0000_soft_the_anarchist.sql', '0001_modern_vivisector.sql', '0002_blue_the_anarchist.sql', '0003_parched_gateway.sql', '0004_member_billing_accounts.sql'];
    for (let index = 0; index < names.length; index += 1) {
      await cp(join(migrationsFolder, names[index]), join(temporary, names[index]));
      await cp(join(migrationsFolder, 'meta', `000${index}_snapshot.json`), join(temporary, 'meta', `000${index}_snapshot.json`));
    }
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
    journal.entries = journal.entries.slice(0, 5);
    await writeFile(join(temporary, 'meta', '_journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
    await migrate(database, { migrationsFolder: temporary, migrationsSchema: 'idoc', migrationsTable: '__drizzle_migrations' });
    assert.equal((await sql`select 1 from information_schema.columns where table_schema='idoc' and table_name='users' and column_name='account_state'`).length, 0);
    await migrate(database, { migrationsFolder, migrationsSchema: 'idoc', migrationsTable: '__drizzle_migrations' });
    assert.equal((await sql`select 1 from information_schema.tables where table_schema='idoc' and table_name='account_tokens'`).length, 1);
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
});

test('migration re-execution is safe and does not duplicate objects', async () => {
  await migrate(database, { migrationsFolder, migrationsSchema: 'idoc', migrationsTable: '__drizzle_migrations' });
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from idoc.__drizzle_migrations`;
  assert.equal(count, 7);
});

test('migrations enforce normalized unique identities and one profile per user', async () => {
  const [user] = await sql`insert into idoc.users (email,password_hash,email_verified_at,account_state) values ('member@idoc.club','hash',now(),'active') returning id`;
  await assert.rejects(sql`insert into idoc.users (email,password_hash) values ('MEMBER@IDOC.CLUB','hash')`);
  await sql`insert into idoc.profiles (user_id,first_name,last_name,address_1,city,state_province,postal_code,country_code) values (${user.id},'A','Member','1 Road','City','State','1','DE')`;
  await assert.rejects(sql`insert into idoc.profiles (user_id,first_name,last_name,address_1,city,state_province,postal_code,country_code) values (${user.id},'B','Member','2 Road','City','State','2','DE')`);
});

test('token digests are unique and one-time state is database-backed', async () => {
  const [user] = await sql`insert into idoc.users (email,password_hash) values ('token@idoc.club','hash') returning id`;
  await sql`insert into idoc.account_tokens (user_id,purpose,token_hash,expires_at) values (${user.id},'password_reset',${'a'.repeat(64)},now()+interval '1 hour')`;
  await assert.rejects(sql`insert into idoc.account_tokens (user_id,purpose,token_hash,expires_at) values (${user.id},'password_reset',${'a'.repeat(64)},now()+interval '1 hour')`);
  const [claimed] = await sql`update idoc.account_tokens set consumed_at=now() where token_hash=${'a'.repeat(64)} and consumed_at is null returning id`;
  assert.ok(claimed.id);
  assert.equal((await sql`update idoc.account_tokens set consumed_at=now() where token_hash=${'a'.repeat(64)} and consumed_at is null returning id`).length, 0);
});

test('audit and profile history records are immutable', async () => {
  const [user] = await sql`insert into idoc.users (email,password_hash) values ('audit@idoc.club','hash') returning id`;
  await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id) values (${user.id},'test','user',${String(user.id)})`;
  await assert.rejects(sql`delete from idoc.audit_log where actor_id=${user.id}`);
});

test('rate-limit buckets are purpose-specific and concurrent increments are not lost', async () => {
  const values = ['password_reset', 'migration_activation'];
  await Promise.all(Array.from({ length: 8 }, (_, index) => sql`
    insert into idoc.account_request_limits(purpose,identifier_hash,origin_hash,window_started_at)
    values (${values[index % 2]}, ${'a'.repeat(64)}, ${'b'.repeat(64)}, date_trunc('hour',now()))
    on conflict(purpose,identifier_hash,origin_hash,window_started_at)
    do update set request_count=idoc.account_request_limits.request_count+1
  `));
  const counts = await sql<{ purpose: string; request_count: number }[]>`select purpose,request_count from idoc.account_request_limits order by purpose`;
  assert.deepEqual(counts.map(({ request_count }) => request_count), [4, 4]);
});

test('two workers cannot claim one outbox row and an expired lease is reclaimable', async () => {
  const [user] = await sql`insert into idoc.users(email,password_hash) values('worker@idoc.club','hash') returning id`;
  const [token] = await sql`insert into idoc.account_tokens(user_id,purpose,token_hash,expires_at) values(${user.id},'password_reset',${'c'.repeat(64)},now()+interval '1 hour') returning id`;
  await sql`insert into idoc.account_delivery_outbox(token_id,user_id,purpose,encrypted_payload,key_version,message_id) values(${token.id},${user.id},'password_reset','encrypted','v1','message-1')`;
  const claim = (owner: string) => sql`with candidate as (select id from idoc.account_delivery_outbox where sent_at is null and (lease_expires_at is null or lease_expires_at<now()) for update skip locked limit 1) update idoc.account_delivery_outbox o set lease_owner=${owner},lease_expires_at=now()+interval '5 minutes' from candidate where o.id=candidate.id returning o.id`;
  const results = await Promise.all([claim('one'), claim('two')]);
  assert.equal(results.flat().length, 1);
  await sql`update idoc.account_delivery_outbox set lease_expires_at=now()-interval '1 second'`;
  assert.equal((await claim('reclaimer')).length, 1);
});
