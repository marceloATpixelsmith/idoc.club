import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required for the isolated database integration suite.');
const parsed = new URL(url);
if (!/test/i.test(parsed.pathname) || /prod(uction)?|render\.com/i.test(`${parsed.hostname}${parsed.pathname}`)) {
  throw new Error('TEST_DATABASE_URL must identify an explicitly named non-production test database.');
}
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
  assert.equal(count, 6);
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
  assert.equal(count, 6);
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
