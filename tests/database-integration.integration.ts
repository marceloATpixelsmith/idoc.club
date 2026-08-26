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
// A pool larger than one is intentional: lease and token races must use distinct
// PostgreSQL connections rather than merely interleaving promises in JavaScript.
const sql = postgres(url, { max: 10 });
const database = drizzle(sql);
const migrationsFolder = new URL('../lib/db/migrations', import.meta.url).pathname;

before(async () => {
  await sql.unsafe('DROP SCHEMA IF EXISTS idoc CASCADE');
});
after(async () => { await sql.unsafe('DROP SCHEMA IF EXISTS idoc CASCADE'); await sql.end(); });

test('Drizzle applies every migration to an empty isolated database', async () => {
  await migrate(database, { migrationsFolder, migrationsSchema: 'idoc', migrationsTable: '__drizzle_migrations' });
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from idoc.__drizzle_migrations`;
  assert.equal(count, 24);
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

test('forward migration preserves databases that already applied released migration 0007', async () => {
  await sql.unsafe('DROP SCHEMA IF EXISTS idoc CASCADE');
  const temporary = await mkdtemp(join(tmpdir(), 'idoc-released-0007-'));
  try {
    await mkdir(join(temporary, 'meta'));
    const names = [
      '0000_soft_the_anarchist.sql',
      '0001_modern_vivisector.sql',
      '0002_blue_the_anarchist.sql',
      '0003_parched_gateway.sql',
      '0004_member_billing_accounts.sql',
      '0005_release_one_account_tokens.sql',
      '0006_durable_account_delivery.sql',
      '0007_account_delivery_token_eligibility.sql',
    ];
    for (let index = 0; index < names.length; index += 1) {
      await cp(join(migrationsFolder, names[index]), join(temporary, names[index]));
      await cp(join(migrationsFolder, 'meta', `000${index}_snapshot.json`), join(temporary, 'meta', `000${index}_snapshot.json`));
    }
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
    journal.entries = journal.entries.slice(0, 8);
    await writeFile(join(temporary, 'meta', '_journal.json'), `${JSON.stringify(journal, null, 2)}\n`);

    await migrate(database, { migrationsFolder: temporary, migrationsSchema: 'idoc', migrationsTable: '__drizzle_migrations' });
    assert.equal((await sql`select 1 from information_schema.columns where table_schema='idoc' and table_name='account_delivery_outbox' and column_name='terminal_at'`).length, 1);

    await migrate(database, { migrationsFolder, migrationsSchema: 'idoc', migrationsTable: '__drizzle_migrations' });
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from idoc.__drizzle_migrations`;
    assert.equal(count, 24);
    assert.equal((await sql`select 1 from information_schema.columns where table_schema='idoc' and table_name='account_delivery_outbox' and column_name='terminal_reason'`).length, 1);
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
});

test('generated migration metadata agrees with the migrated schema', async () => {
  const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
  assert.deepEqual(journal.entries.map(({ idx }: { idx: number }) => idx), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  assert.equal(journal.entries[7].tag, '0007_account_delivery_token_eligibility');
  assert.equal(journal.entries[7].when, 1786495321357, 'released migration 0007 timestamp must remain immutable');
  assert.equal(journal.entries[8].tag, '0008_reconcile_account_delivery_eligibility');
  assert.ok(journal.entries[8].when > journal.entries[6].when, 'forward reconciliation must follow migration 0006');
  assert.equal(journal.entries[9].tag, '0009_great_groot');
  assert.equal(journal.entries[10].tag, '0010_workable_dagger');
  assert.ok(journal.entries[10].when > journal.entries[9].when, 'forward reconciliation must follow migration 0009');
  assert.equal(journal.entries[11].tag, '0011_wide_jazinda');
  assert.ok(journal.entries[11].when > journal.entries[10].when, 'the subscriptions/payments migration must follow migration 0010');
  assert.equal(journal.entries[12].tag, '0012_wild_moon_knight');
  assert.ok(journal.entries[12].when > journal.entries[11].when, 'the notification_outbox dedupe-key migration must follow migration 0011');
  assert.equal(journal.entries[13].tag, '0013_tranquil_wendell_vaughn');
  assert.ok(journal.entries[13].when > journal.entries[12].when, 'the reconciliation tables migration must follow migration 0012');
  assert.equal(journal.entries[14].tag, '0014_small_the_stranger');
  assert.ok(journal.entries[14].when > journal.entries[13].when, 'the official_statuses migration must follow migration 0013');
  assert.equal(journal.entries[15].tag, '0015_conscious_ben_parker');
  assert.ok(journal.entries[15].when > journal.entries[14].when, 'the email_otp_codes migration must follow migration 0014');
  assert.equal(journal.entries[16].tag, '0016_persisted_auth_sessions');
  assert.ok(journal.entries[16].when > journal.entries[15].when, 'the persisted auth sessions migration must follow migration 0015');
  assert.equal(journal.entries[17].tag, '0017_google_oidc');
  assert.ok(journal.entries[17].when > journal.entries[16].when, 'the Google OIDC migration must follow migration 0016');
  assert.equal(journal.entries[18].tag, '0018_external_identity_linking');
  assert.equal(journal.entries[18].when, 1787619600000, 'migration 0018 timestamp must remain immutable');
  assert.ok(journal.entries[18].when > journal.entries[17].when, 'external identity linking must follow migration 0017');
  assert.equal(journal.entries[19].tag, '0019_onboarding_consents');
  assert.ok(journal.entries[19].when > journal.entries[18].when, 'onboarding consent evidence must follow migration 0018');
  assert.equal(journal.entries[20].tag, '0020_durable_mfa_persistence');
  assert.ok(journal.entries[20].when > journal.entries[19].when, 'durable MFA persistence must follow migration 0019');
  assert.equal(journal.entries[21].tag, '0021_password_reset_mfa_purpose');
  assert.ok(journal.entries[21].when > journal.entries[20].when, 'password-reset MFA purpose must follow migration 0020');
  assert.equal(journal.entries[22].tag, '0022_ordinary_login_trusted_devices');
  assert.ok(journal.entries[22].when > journal.entries[21].when, 'ordinary login trust must follow migration 0021');
  assert.equal(journal.entries[23].tag, '0023_broader_auth_security_notifications');
  assert.ok(journal.entries[23].when > journal.entries[22].when, 'broader security notifications must follow migration 0022');
  const snapshot = JSON.parse(await readFile(join(migrationsFolder, 'meta', '0023_snapshot.json'), 'utf8'));
  for (const tableName of Object.keys(snapshot.tables)) {
    const [schemaName, name] = tableName.split('.');
    const rows = await sql`select column_name from information_schema.columns where table_schema=${schemaName} and table_name=${name}`;
    assert.ok(rows.length > 0, `${tableName} from the Drizzle snapshot must exist`);
    const migratedColumns = new Set(rows.map(({ column_name }) => column_name));
    for (const columnName of Object.keys(snapshot.tables[tableName].columns)) {
      assert.ok(migratedColumns.has(columnName), `${tableName}.${columnName} must exist`);
    }
  }
  for (const tableName of ['google_oauth_transactions', 'external_identities', 'auth_security_notification_outbox']) {
    assert.equal((await sql`select 1 from information_schema.tables where table_schema='idoc' and table_name=${tableName}`).length, 1, `idoc.${tableName} from post-snapshot auth migrations must exist`);
  }
  for (const columnName of ['purpose', 'authenticated_user_id']) {
    assert.equal((await sql`select 1 from information_schema.columns where table_schema='idoc' and table_name='google_oauth_transactions' and column_name=${columnName}`).length, 1, `idoc.google_oauth_transactions.${columnName} from migration 0018 must exist`);
  }
});

test('final migrated catalog exactly agrees with the authoritative Drizzle snapshot', async () => {
  const snapshot = JSON.parse(await readFile(join(migrationsFolder, 'meta', '0023_snapshot.json'), 'utf8'));
  assert.deepEqual(Object.keys(snapshot.schemas).sort(), ['idoc']);
  assert.deepEqual(snapshot.enums, {});

  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema='idoc' and table_type='BASE TABLE' and table_name<>'__drizzle_migrations'
    order by table_name`;
  const expectedTables = [...Object.keys(snapshot.tables), 'idoc.auth_security_notification_outbox', 'idoc.external_identities', 'idoc.google_oauth_transactions'].sort();
  assert.deepEqual(tables.map(({ table_name }) => `idoc.${table_name}`), expectedTables);

  const consentColumns = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema='idoc' and table_name='onboarding_consents'
    order by ordinal_position`;
  assert.deepEqual(consentColumns.map(({ column_name }) => column_name), [
    'profile_id', 'terms_accepted_at', 'privacy_accepted_at', 'keep_updated_opt_in', 'created_at',
  ]);

  for (const [qualifiedName, expectedTable] of Object.entries<any>(snapshot.tables)) {
    const tableName = expectedTable.name;
    const columns = await sql<any[]>`
      select a.attname as name, format_type(a.atttypid,a.atttypmod) as type,
        a.attnotnull as not_null, pg_get_expr(d.adbin,d.adrelid) as default,
        a.attidentity as identity, a.attgenerated as generated
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where n.nspname='idoc' and c.relname=${tableName} and a.attnum>0 and not a.attisdropped order by a.attnum`;
    // Column order is not semantically meaningful (Drizzle and this codebase always address columns
    // by name); a column added by a later ALTER TABLE migration physically appends at the end
    // regardless of where it's declared in schema.ts, so only the column set is compared here.
    assert.deepEqual(columns.map(({ name }) => name).sort(), Object.keys(expectedTable.columns).sort(), `${qualifiedName} column set`);
    for (const column of columns) {
      const expected = expectedTable.columns[column.name];
      const expectedType = expected.type === 'serial'
        ? 'integer'
        : expected.type === 'timestamp'
          ? 'timestamp without time zone'
          : expected.type.replace(/^varchar/, 'character varying');
      assert.equal(column.type, expectedType, `${qualifiedName}.${column.name} type`);
      assert.equal(column.not_null, expected.notNull, `${qualifiedName}.${column.name} nullability`);
      assert.equal(column.identity, '', `${qualifiedName}.${column.name} identity behavior`);
      assert.equal(column.generated, '', `${qualifiedName}.${column.name} generated behavior`);
      if (expected.type === 'serial') assert.match(column.default, /^nextval\('/, `${qualifiedName}.${column.name} serial sequence default`);
      else assert.equal(normalizeSql(column.default), normalizeSql(expected.default ?? null), `${qualifiedName}.${column.name} default`);
    }

    const constraints = await sql<any[]>`
      select con.conname as name, con.contype as type,
        array(select a.attname from unnest(con.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.attnum order by k.ord) as columns,
        rn.nspname as target_schema, rc.relname as target_table,
        array(select a.attname from unnest(con.confkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.attnum order by k.ord) as target_columns,
        con.confupdtype as update_action, con.confdeltype as delete_action, pg_get_constraintdef(con.oid,true) as definition
      from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
      left join pg_class rc on rc.oid=con.confrelid left join pg_namespace rn on rn.oid=rc.relnamespace
      where n.nspname='idoc' and c.relname=${tableName} order by con.conname`;
    const expectedConstraints = [
      ...Object.values<any>(expectedTable.foreignKeys).map((value) => ({ name: value.name.slice(0, 63), type: 'f', columns: value.columnsFrom, target_schema: value.schemaTo, target_table: value.tableTo, target_columns: value.columnsTo, update_action: actionCode(value.onUpdate), delete_action: actionCode(value.onDelete) })),
      ...Object.values<any>(expectedTable.uniqueConstraints).map((value) => ({ name: value.name, type: 'u', columns: value.columns })),
      ...Object.values<any>(expectedTable.checkConstraints).map((value) => ({ name: value.name, type: 'c' })),
      ...Object.values<any>(expectedTable.compositePrimaryKeys),
      ...Object.values<any>(expectedTable.columns).filter((value) => value.primaryKey).map(() => ({ name: `${tableName}_pkey`, type: 'p' })),
    ];
    assert.deepEqual(constraints.map(({ name, type }) => ({ name, type })), expectedConstraints.map(({ name, type }) => ({ name, type })).sort((a, b) => a.name.localeCompare(b.name)), `${qualifiedName} constraint names/types`);
    for (const expected of expectedConstraints) {
      const actual = constraints.find(({ name }) => name === expected.name);
      if (expected.columns) assert.deepEqual(actual.columns, expected.columns, `${qualifiedName}.${expected.name} columns`);
      if (expected.type === 'f') assert.deepEqual({ target_schema: actual.target_schema, target_table: actual.target_table, target_columns: actual.target_columns, update_action: actual.update_action, delete_action: actual.delete_action }, { target_schema: expected.target_schema, target_table: expected.target_table, target_columns: expected.target_columns, update_action: expected.update_action, delete_action: expected.delete_action }, `${qualifiedName}.${expected.name} foreign-key behavior`);
      if (expected.type === 'c') {
        const declared = expectedTable.checkConstraints[expected.name].value as string;
        // Compare the exact set of literals (not just declared ⊆ actual) so an actual constraint
        // that permits an extra, undeclared value cannot silently pass as "exact parity".
        const declaredLiterals = (declared.match(/'[^']*'/g) ?? []).sort();
        const actualLiterals = (actual.definition.match(/'[^']*'/g) ?? []).sort();
        assert.deepEqual(actualLiterals, declaredLiterals, `${qualifiedName}.${expected.name} check literals`);
        for (const columnName of Object.keys(expectedTable.columns).filter((name) => declared.includes(`\"${name}\"`))) assert.ok(actual.definition.includes(columnName), `${qualifiedName}.${expected.name} check column ${columnName}`);
        if (declared.includes('>=')) assert.ok(actual.definition.includes('>='), `${qualifiedName}.${expected.name} check operator`);
      }
    }

    const indexes = await sql<any[]>`
      select i.relname as name, x.indisunique as unique, x.indisprimary as primary,
        pg_get_expr(x.indpred,x.indrelid) as predicate,
        array(select pg_get_indexdef(x.indexrelid,k,true) from generate_series(1,x.indnkeyatts) k) as expressions
      from pg_index x join pg_class t on t.oid=x.indrelid join pg_namespace n on n.oid=t.relnamespace join pg_class i on i.oid=x.indexrelid
      where n.nspname='idoc' and t.relname=${tableName} order by i.relname`;
    const expectedIndexNames = new Set([
      ...Object.keys(expectedTable.indexes), ...Object.keys(expectedTable.uniqueConstraints),
      ...Object.values<any>(expectedTable.columns).filter((value) => value.primaryKey).map(() => `${tableName}_pkey`),
    ]);
    assert.deepEqual(indexes.map(({ name }) => name), [...expectedIndexNames].sort(), `${qualifiedName} complete index set`);
    for (const expected of Object.values<any>(expectedTable.indexes)) {
      const actual = indexes.find(({ name }) => name === expected.name);
      assert.equal(actual.unique, expected.isUnique, `${qualifiedName}.${expected.name} uniqueness`);
      assert.equal(normalizeSql(actual.predicate), normalizeSql(expected.where ?? null), `${qualifiedName}.${expected.name} predicate`);
      assert.deepEqual(actual.expressions.map(normalizeSql), expected.columns.map(({ expression }: any) => normalizeSql(expression)), `${qualifiedName}.${expected.name} keys/expressions`);
    }
  }

  const triggers = await sql<any[]>`
    select c.relname as table_name,t.tgname as name,p.proname as function_name,
      pg_get_triggerdef(t.oid,true) as definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid
    where n.nspname='idoc' and not t.tgisinternal order by c.relname,t.tgname`;
  assert.deepEqual(triggers.map(({ table_name, name, function_name }) => ({ table_name, name, function_name })), [
    { table_name: 'audit_log', name: 'audit_log_immutable', function_name: 'reject_immutable_history_change' },
    { table_name: 'profile_change_history', name: 'profile_change_history_immutable', function_name: 'reject_immutable_history_change' },
  ]);
  for (const trigger of triggers) assert.match(trigger.definition, /BEFORE DELETE OR UPDATE/);
  assert.equal((await sql`select count(*)::int as count from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='idoc' and t.typtype='e'`)[0].count, 0, 'enum semantics are represented by the compared checks');
});

function normalizeSql(value: unknown) {
  if (value === null || value === undefined) return null;
  return String(value).toLowerCase().replaceAll('"', '').replaceAll(/idoc\.[a-z0-9_]+\./g, '').replaceAll(/::(?:character varying|text|timestamp without time zone)/g, '').replaceAll(/[()\s]+/g, ' ').trim();
}

function actionCode(action: string) {
  return ({ 'no action': 'a', restrict: 'r', cascade: 'c', 'set null': 'n', 'set default': 'd' } as Record<string, string>)[action];
}

test('migration re-execution is safe and does not duplicate objects', async () => {
  await migrate(database, { migrationsFolder, migrationsSchema: 'idoc', migrationsTable: '__drizzle_migrations' });
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from idoc.__drizzle_migrations`;
  assert.equal(count, 24);
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
  const [profile] = await sql`insert into idoc.profiles (user_id,first_name,last_name,address_1,city,state_province,postal_code,country_code) values (${user.id},'Audit','Member','1 Road','City','State','1','DE') returning id`;
  const [audit] = await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id) values (${user.id},'test','user',${String(user.id)}) returning id`;
  const [history] = await sql`insert into idoc.profile_change_history(profile_id,actor_id,before_json,after_json) values (${profile.id},${user.id},${JSON.stringify({ firstName: 'Before' })}::jsonb,${JSON.stringify({ firstName: 'After' })}::jsonb) returning id`;
  await assert.rejects(sql`update idoc.audit_log set action='changed' where id=${audit.id}`);
  await assert.rejects(sql`delete from idoc.audit_log where actor_id=${user.id}`);
  await assert.rejects(sql`update idoc.profile_change_history set after_json=${JSON.stringify({ firstName: 'Changed' })}::jsonb where id=${history.id}`);
  await assert.rejects(sql`delete from idoc.profile_change_history where id=${history.id}`);
  assert.equal((await sql`select id from idoc.audit_log where id=${audit.id}`).length, 1);
  assert.equal((await sql`select id from idoc.profile_change_history where id=${history.id}`).length, 1);
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

  await sql`alter table idoc.account_delivery_outbox drop constraint account_delivery_outbox_token_id_account_tokens_id_fk`;
  await sql`insert into idoc.account_delivery_outbox(token_id,user_id,purpose,encrypted_payload,key_version,message_id) values(2147483647,${owner.id},'password_reset','encrypted','v1','missing')`;
  const [missing] = await classifyAndClaim('missing-worker');
  assert.equal(missing.eligible, false);
  assert.equal(missing.terminal_reason, 'missing_token');
  await sql`alter table idoc.account_delivery_outbox add constraint account_delivery_outbox_token_id_account_tokens_id_fk foreign key(token_id) references idoc.account_tokens(id) not valid`;

  await sql`update idoc.account_delivery_outbox set sent_at=now(),lease_owner=null,lease_expires_at=null where message_id='eligible'`;
  const [{ consumed_at }] = await sql`select consumed_at from idoc.account_tokens where id=${tokens[0].id}`;
  assert.equal(consumed_at, null);
});

test('account states and current entitlement remain independent database facts', async () => {
  const [user] = await sql`insert into idoc.users(email,password_hash,email_verified_at,account_state) values('suspended-entitled@idoc.club','hash',now(),'suspended') returning id`;
  const [profile] = await sql`insert into idoc.profiles(user_id,first_name,last_name,address_1,city,state_province,postal_code,country_code) values(${user.id},'Safe','Member','1 Road','City','State','1','DE') returning id`;
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'active',current_date,current_date+365,'import')`;
  const [record] = await sql`select u.account_state,m.status,m.valid_until>=current_date as current from idoc.users u join idoc.profiles p on p.user_id=u.id join idoc.memberships m on m.profile_id=p.id where u.id=${user.id}`;
  assert.deepEqual(record, { account_state: 'suspended', current: true, status: 'active' });
});
