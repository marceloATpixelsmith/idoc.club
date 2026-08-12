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
  assert.equal(count, 8);
});

test('Drizzle applies account-delivery migrations to a database already at 0004', async () => {
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

test('generated migration metadata agrees with the migrated schema', async () => {
  const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
  assert.deepEqual(journal.entries.map(({ idx }: { idx: number }) => idx), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(journal.entries[7].tag, '0007_account_delivery_token_eligibility');
  assert.ok(journal.entries[7].when > journal.entries[6].when, 'migration 0007 must follow migration 0006');
  const snapshot = JSON.parse(await readFile(join(migrationsFolder, 'meta', '0007_snapshot.json'), 'utf8'));
  for (const tableName of Object.keys(snapshot.tables)) {
    const [schemaName, name] = tableName.split('.');
    const rows = await sql`select column_name from information_schema.columns where table_schema=${schemaName} and table_name=${name}`;
    assert.ok(rows.length > 0, `${tableName} from the Drizzle snapshot must exist`);
    const migratedColumns = new Set(rows.map(({ column_name }) => column_name));
    for (const columnName of Object.keys(snapshot.tables[tableName].columns)) {
      assert.ok(migratedColumns.has(columnName), `${tableName}.${columnName} must exist`);
    }
  }
});

test('migration re-execution is safe and does not duplicate objects', async () => {
  await migrate(database, { migrationsFolder, migrationsSchema: 'idoc', migrationsTable: '__drizzle_migrations' });
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from idoc.__drizzle_migrations`;
  assert.equal(count, 8);
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

test('outbox lease ownership prevents stale finalization and delivered rows are not reclaimed', async () => {
  const [user] = await sql`insert into idoc.users(email,password_hash) values('lease-owner@idoc.club','hash') returning id`;
  const tokens = await Promise.all(['d', 'e'].map(async (character) => {
    const [token] = await sql`insert into idoc.account_tokens(user_id,purpose,token_hash,expires_at) values(${user.id},'password_reset',${character.repeat(64)},now()+interval '1 hour') returning id`;
    return token;
  }));
  await Promise.all(tokens.map((token, index) => sql`insert into idoc.account_delivery_outbox(token_id,user_id,purpose,encrypted_payload,key_version,message_id) values(${token.id},${user.id},'password_reset','encrypted','v1',${`lease-message-${index}`})`));
  const claim = (owner: string) => sql`with candidate as (select id from idoc.account_delivery_outbox where sent_at is null and dead_lettered_at is null and available_at<=now() and (lease_expires_at is null or lease_expires_at<now()) order by id for update skip locked limit 1) update idoc.account_delivery_outbox o set lease_owner=${owner},lease_expires_at=now()+interval '5 minutes' from candidate where o.id=candidate.id returning o.id`;
  const [first, second] = await Promise.all([claim('worker-a'), claim('worker-b')]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.notEqual(first[0].id, second[0].id);
  assert.equal((await sql`update idoc.account_delivery_outbox set sent_at=now() where id=${first[0].id} and lease_owner='stale-worker' returning id`).length, 0);
  assert.equal((await sql`update idoc.account_delivery_outbox set sent_at=now(),lease_owner=null,lease_expires_at=null where id=${first[0].id} and lease_owner='worker-a' returning id`).length, 1);
  assert.equal((await sql`update idoc.account_delivery_outbox set lease_owner='thief' where id=${second[0].id} and lease_expires_at<now() returning id`).length, 0);
  await sql`update idoc.account_delivery_outbox set lease_expires_at=now()-interval '1 second' where id=${second[0].id}`;
  assert.equal((await claim('worker-c')).length, 1);
  assert.equal((await claim('worker-d')).some(({ id }) => id === first[0].id), false);
});

test('account delivery atomically terminalizes ineligible tokens and leases only a usable match', async () => {
  const [owner, other] = await Promise.all([
    sql`insert into idoc.users(email,password_hash) values('eligibility-owner@idoc.club','hash') returning id`.then((rows) => rows[0]),
    sql`insert into idoc.users(email,password_hash) values('eligibility-other@idoc.club','hash') returning id`.then((rows) => rows[0]),
  ]);
  const tokenSpecs = [
    [owner.id, 'password_reset', '1', "now()+interval '1 hour'", null],
    [owner.id, 'password_reset', '2', "now()-interval '1 hour'", null],
    [owner.id, 'password_reset', '3', "now()+interval '1 hour'", 'now()'],
    [other.id, 'password_reset', '4', "now()+interval '1 hour'", null],
    [owner.id, 'migration_activation', '5', "now()+interval '1 hour'", null],
  ] as const;
  const tokens = [];
  for (const [userId, purpose, character, expires, consumed] of tokenSpecs) {
    const [token] = await sql.unsafe(`insert into idoc.account_tokens(user_id,purpose,token_hash,expires_at,consumed_at) values($1,$2,$3,${expires},${consumed ?? 'null'}) returning id`, [userId, purpose, character.repeat(64)]);
    tokens.push(token);
  }
  const outboxSpecs = [
    [tokens[0].id, owner.id, 'password_reset', 'eligible'],
    [tokens[1].id, owner.id, 'password_reset', 'expired'],
    [tokens[2].id, owner.id, 'password_reset', 'consumed'],
    [tokens[3].id, owner.id, 'password_reset', 'wrong-user'],
    [tokens[4].id, owner.id, 'password_reset', 'wrong-purpose'],
  ] as const;
  for (const [tokenId, userId, purpose, message] of outboxSpecs) {
    await sql`insert into idoc.account_delivery_outbox(token_id,user_id,purpose,encrypted_payload,key_version,message_id) values(${tokenId},${userId},${purpose},'encrypted','v1',${message})`;
  }
  const classifyAndClaim = (worker: string) => sql`
    with candidate as (
      select o.id, (t.id is not null and t.user_id=o.user_id and t.purpose=o.purpose and t.consumed_at is null and t.expires_at>now()) eligible,
        case when t.id is null then 'missing_token' when t.user_id<>o.user_id then 'user_mismatch' when t.purpose<>o.purpose then 'purpose_mismatch' when t.consumed_at is not null then 'consumed_token' else 'expired_token' end terminal_reason
      from idoc.account_delivery_outbox o left join idoc.account_tokens t on t.id=o.token_id
      where o.message_id in ('eligible','expired','consumed','wrong-user','wrong-purpose','missing') and o.sent_at is null and o.dead_lettered_at is null and o.terminal_at is null and (o.lease_expires_at is null or o.lease_expires_at<now())
      order by o.id for update of o skip locked limit 1
    ) update idoc.account_delivery_outbox o set lease_owner=case when candidate.eligible then ${worker} else null end,
      lease_expires_at=case when candidate.eligible then now()+interval '5 minutes' else null end,
      terminal_at=case when candidate.eligible then null else now() end,
      terminal_reason=case when candidate.eligible then null else candidate.terminal_reason end
    from candidate where o.id=candidate.id returning o.id,candidate.eligible,o.terminal_reason
  `;
  const outcomes = [];
  for (let index = 0; index < 5; index += 1) outcomes.push((await classifyAndClaim(`worker-${index}`))[0]);
  assert.equal(outcomes.filter(({ eligible }) => eligible).length, 1);
  assert.deepEqual(new Set(outcomes.filter(({ eligible }) => !eligible).map(({ terminal_reason }) => terminal_reason)), new Set(['expired_token', 'consumed_token', 'user_mismatch', 'purpose_mismatch']));
  assert.equal((await classifyAndClaim('later')).length, 0);
  assert.equal((await Promise.all([classifyAndClaim('overlap-a'), classifyAndClaim('overlap-b')])).flat().length, 0);

  await sql`alter table idoc.account_delivery_outbox drop constraint account_delivery_token_fk`;
  await sql`insert into idoc.account_delivery_outbox(token_id,user_id,purpose,encrypted_payload,key_version,message_id) values(2147483647,${owner.id},'password_reset','encrypted','v1','missing')`;
  const [missing] = await classifyAndClaim('missing-worker');
  assert.equal(missing.eligible, false);
  assert.equal(missing.terminal_reason, 'missing_token');
  await sql`alter table idoc.account_delivery_outbox add constraint account_delivery_token_fk foreign key(token_id) references idoc.account_tokens(id) not valid`;

  await sql`update idoc.account_delivery_outbox set sent_at=now(),lease_owner=null,lease_expires_at=null where message_id='eligible'`;
  const [{ consumed_at }] = await sql`select consumed_at from idoc.account_tokens where id=${tokens[0].id}`;
  assert.equal(consumed_at, null);
});

test('account states and current entitlement remain independent database facts', async () => {
  const [user] = await sql`insert into idoc.users(email,password_hash,email_verified_at,account_state) values('suspended-entitled@idoc.club','hash',now(),'suspended') returning id`;
  const [profile] = await sql`insert into idoc.profiles(user_id,first_name,last_name,address_1,city,state_province,postal_code,country_code) values(${user.id},'Safe','Member','1 Road','City','State','1','DE') returning id`;
  await sql`insert into idoc.memberships(profile_id,status,valid_from,valid_until,source) values(${profile.id},'active',current_date,current_date+365,'import')`;
  const [record] = await sql`select u.account_state,m.status,m.valid_until>=current_date as current from idoc.users u join idoc.profiles p on p.user_id=u.id join idoc.memberships m on m.profile_id=p.id where u.id=${user.id}`;
  assert.deepEqual(record, { account_state: 'suspended', current: true, status: 'active' });
});
