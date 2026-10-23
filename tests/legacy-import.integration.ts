import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { db } from '../lib/db/drizzle.ts';
import { validateMigrationActivationFoundation } from '../lib/membership/account-recovery.ts';
import { assertImportAllowed, LegacyImportBlockedError, runLegacyImport } from '../lib/legacy-import/import-run.ts';
import { parseMysqlDump } from '../lib/legacy-import/mysql-dump.ts';
import { isNeededLegacyTable } from '../lib/legacy-import/reduce-dump.ts';
import type { StripeSnapshot } from '../lib/legacy-import/stripe-reconcile.ts';
import { planLegacyImport, summarizePlan } from '../lib/legacy-import/transform.ts';
import { adminUser, closeHarness, createUser, resetIdoc, sql } from './postgres-harness.ts';

// TEMPORARY legacy import (docs/03 section 12): drives the real write step against PostgreSQL with a small, hand-built plan.
const q = (value: string | number | null) => (value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`);
const insert = (table: string, columns: string[], rows: Array<Array<string | number | null>>) =>
  `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES\n${rows.map((r) => `(${r.map(q).join(',\t')})`).join(',\n')};\n`;
const USER = ['ID', 'user_login', 'user_pass', 'user_email', 'user_registered', 'user_status', 'spam', 'deleted'];
const META = ['umeta_id', 'user_id', 'meta_key', 'meta_value'];
const TX = ['id', 'amount', 'total', 'user_id', 'product_id', 'trans_num', 'status', 'txn_type', 'gateway', 'subscription_id', 'created_at', 'expires_at'];
const SUB = ['id', 'user_id', 'product_id', 'subscr_id', 'status', 'created_at'];
const profile = {
  first_name: 'Ada', last_name: 'Lovelace', 'mepr-address-one': '1 Main St', 'mepr-address-city': 'Town', 'mepr-address-state': 'ST', 'mepr-address-zip': '12345',
  'mepr-address-country': 'DE', mepr_national_federation: 'de', mepr_idoc_region: 'western-europe-africa', mepr_fei_number: '10001',
  mepr_official_status_as_judge: 'a:1:{s:25:"national-grand-prix-judge";s:2:"on";}', mepr_are_you_a_technical_delegate: 'yes',
};
let metaId = 0;
const meta = (userId: number, values: Record<string, string>) => Object.entries(values).map(([key, value]) => [++metaId, userId, key, value]);
const bcrypt = '$wp$2y$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';
const phpass = '$P$B1234567890123456789012345678901';

function plan() {
  const dump = parseMysqlDump([
    insert('wp_users', USER, [
      [1, 'ada', phpass, 'Ada@Example.com', '2020-03-01 10:00:00', 0, 0, 0],
      [2, 'bea', bcrypt, 'bea@example.com', '2021-04-01 10:00:00', 0, 0, 0],
      [3, 'cy', 'plain-md5-hash', 'cy@example.com', '2022-05-01 10:00:00', 0, 0, 0],
    ]),
    insert('wp_usermeta', META, [...meta(1, { ...profile, '_mepr_stripe_customer_id_x_EUR': 'cus_ADA' }), ...meta(2, { ...profile, first_name: 'Bea' }), ...meta(3, { ...profile, first_name: 'Cy' })]),
    insert('wp_mepr_transactions', TX, [
      [1, '80.00', '80.00', 1, 2042, 'ch_ada1', 'complete', 'payment', 'stripe', 'sub_ada', '2026-05-01 00:00:00', '2027-05-01 00:00:00'],
      [2, '80.00', '80.00', 2, 2042, 'mp-bea1', 'complete', 'payment', 'manual', 0, '2026-09-01 00:00:00', '2027-09-01 00:00:00'],
      [3, '80.00', '80.00', 3, 2042, 'ch_cy1', 'refunded', 'payment', 'stripe', 0, '2026-08-01 00:00:00', '2026-10-15 00:00:00'],
      [4, '80.00', '80.00', 3, 2042, 'mp-cy2', 'complete', 'payment', 'manual', 0, '2026-08-02 00:00:00', '2026-10-15 00:00:00'],
    ]),
    insert('wp_mepr_subscriptions', SUB, [[1, 1, 2042, 'sub_ada', 'active', '2025-05-01 00:00:00']]),
  ].join(''), isNeededLegacyTable);
  return planLegacyImport(dump, { asOf: '2026-10-17' });
}

const snapshot: StripeSnapshot = {
  subscriptions: [{ id: 'sub_ada', customerId: 'cus_ADA', status: 'active', email: '', priceId: 'price_8000', currentPeriodEnd: '2027-05-01', cancelAtPeriodEnd: false }],
  customerIds: new Set(['cus_ADA']), chargeRefs: new Set(['ch_ada1', 'ch_cy1']), truncated: { subscriptions: false, customers: false, charges: false },
};
const okStripe = { state: 'ok' as const, message: null, partial: false, skipped: [], removedPeople: { checked: 0, live: 0, cancelled: 0, notFound: 0, undetermined: false }, fetched: { subscriptions: 1, customers: 1, charges: 2 }, groups: [] };
function reviewed() {
  const reviewedPlan = plan();
  const report = summarizePlan(reviewedPlan);
  report.review = [];
  report.stripeReconciliation = okStripe;
  return { plan: reviewedPlan, report };
}

beforeEach(async () => { await resetIdoc(); process.env.DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING = 'true'; });
after(closeHarness);

test('the import writes members, memberships, payments, subscriptions and mapping, and is safe to run twice', async () => {
  const admin = await adminUser();
  const { plan: reviewedPlan, report } = reviewed();
  const summary = await runLegacyImport({ plan: reviewedPlan, report, snapshot, actorId: admin.id, fileFingerprints: ['a'.repeat(64), 'b'.repeat(64)] });
  assert.equal(summary.imported, 3);
  assert.equal(summary.refunds, 1);
  assert.equal(summary.subscriptions, 1);

  const [ada] = await sql`select u.email, u.email_display, u.account_state, u.legacy_password_format, u.password_hash, p.legacy_wp_user_id, p.country_code
    from idoc.users u join idoc.profiles p on p.user_id = u.id where p.legacy_wp_user_id = 1`;
  assert.equal(ada.email, 'ada@example.com');
  assert.equal(ada.email_display, 'Ada@Example.com');
  assert.equal(ada.account_state, 'migrated_pending');
  assert.equal(ada.legacy_password_format, 'phpass');
  assert.equal(ada.password_hash, '!legacy-import-no-password-yet');
  const [unsupported] = await sql`select u.legacy_password_hash, u.legacy_password_format from idoc.users u join idoc.profiles p on p.user_id = u.id where p.legacy_wp_user_id = 3`;
  assert.deepEqual({ ...unsupported }, { legacy_password_hash: null, legacy_password_format: null });

  const memberships = await sql`select p.legacy_wp_user_id as legacy, m.status, m.valid_until::text as valid_until, m.grace_ends_on::text as grace_ends_on, m.source
    from idoc.memberships m join idoc.profiles p on p.id = m.profile_id order by p.legacy_wp_user_id`;
  assert.deepEqual(memberships.map((row) => ({ ...row })), [
    { legacy: 1, status: 'active', valid_until: '2027-05-01', grace_ends_on: null, source: 'migration' },
    { legacy: 2, status: 'active', valid_until: '2027-09-01', grace_ends_on: null, source: 'migration' },
    { legacy: 3, status: 'grace', valid_until: '2026-10-15', grace_ends_on: '2026-10-20', source: 'migration' },
  ]);

  const paymentRows = await sql`select source, external_payment_id, amount_cents, administrator_id from idoc.payments order by id`;
  assert.deepEqual(paymentRows.map((row) => row.source).sort(), ['legacy_import', 'legacy_import', 'stripe_recurring', 'stripe_one_time'].sort());
  assert.ok(paymentRows.filter((row) => row.source === 'legacy_import').every((row) => row.administrator_id === admin.id));
  assert.equal((await sql`select 1 from idoc.payment_refunds where status = 'succeeded'`).length, 1);
  assert.deepEqual((await sql`select status, price_id, external_subscription_id from idoc.subscriptions`).map((row) => ({ ...row })), [{ status: 'active', price_id: 'price_8000', external_subscription_id: 'sub_ada' }]);
  assert.deepEqual((await sql`select external_customer_id from idoc.billing_accounts`).map((row) => row.external_customer_id), ['cus_ADA']);
  const modes = await sql`select p.legacy_wp_user_id as legacy, r.current_mode from idoc.renewal_preferences r join idoc.profiles p on p.id = r.profile_id order by 1`;
  assert.deepEqual(modes.map((row) => row.current_mode), ['recurring', 'non_recurring', 'non_recurring']);
  assert.equal((await sql`select 1 from idoc.migration_map where legacy_type = 'wp_user' and disposition = 'imported'`).length, 3);
  assert.equal((await sql`select 1 from idoc.audit_log where action = 'admin.legacy_import.import'`).length, 1);
  // Nothing was queued for delivery.
  assert.equal((await sql`select count(*)::int as n from idoc.account_delivery_outbox`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from idoc.notification_outbox`)[0].n, 0);

  // The imported rows satisfy the existing account-activation foundation (profile, role, entitlement source and mapping).
  const [{ user_id: complete }] = await sql`select user_id from idoc.profiles where legacy_wp_user_id = 2`;
  assert.equal(await db.transaction((tx) => validateMigrationActivationFoundation(tx, complete)), true);

  const again = await runLegacyImport({ plan: reviewedPlan, report, snapshot, actorId: admin.id, fileFingerprints: ['a'.repeat(64), 'b'.repeat(64)] });
  assert.equal(again.imported, 0);
  assert.equal(again.alreadyImported, 3);
  assert.equal((await sql`select count(*)::int as n from idoc.users where account_state = 'migrated_pending'`)[0].n, 3);
});

test('an existing account is preserved while all other legacy members import', async () => {
  const admin = await adminUser();
  const [existing] = await sql`insert into idoc.users (email, password_hash, account_state) values ('BEA@example.com', 'keep-this-password', 'active') returning id`;
  const { plan: reviewedPlan, report } = reviewed();
  const result = await runLegacyImport({ plan: reviewedPlan, report, snapshot, actorId: admin.id, fileFingerprints: ['a'] });
  assert.equal(result.imported, 2);
  assert.equal(result.skippedExistingAccounts, 1);
  assert.equal(result.skippedExistingBillingReferences, 0);
  assert.equal((await sql`select count(*)::int as n from idoc.migration_map`)[0].n, 2);
  assert.deepEqual((await sql`select legacy_wp_user_id from idoc.profiles order by legacy_wp_user_id`).map((row) => row.legacy_wp_user_id), [1, 3]);
  const [unchanged] = await sql`select id, password_hash, account_state from idoc.users where lower(email) = 'bea@example.com'`;
  assert.equal(unchanged.id, existing.id);
  assert.equal(unchanged.password_hash, 'keep-this-password');
  assert.equal(unchanged.account_state, 'active');
  const again = await runLegacyImport({ plan: reviewedPlan, report, snapshot, actorId: admin.id, fileFingerprints: ['a'] });
  assert.equal(again.imported, 0);
  assert.equal(again.alreadyImported, 2);
  assert.equal(again.skippedExistingAccounts, 1);
});

test('the import refuses to run unless every precondition holds', async () => {
  const { report } = reviewed();
  assert.doesNotThrow(() => assertImportAllowed(report, { DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'true' }, 'idoc'));
  assert.throws(() => assertImportAllowed(report, { DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'false' }, 'idoc'), /hold is off/);
  assert.throws(() => assertImportAllowed(report, { DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'true' }, 'idoc_staging'), /Stripe/);
  assert.throws(() => assertImportAllowed({ ...report, stripeReconciliation: { ...okStripe, partial: true } }, { DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'true' }, 'idoc'), /did not complete/);
  assert.throws(() => assertImportAllowed({ ...report, stripeReconciliation: undefined }, { DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'true' }, 'idoc'), /did not complete/);
  const withDecision = { ...report, review: [{ key: 'x', text: 'x', kind: 'review' as const, remedy: null, held: false, count: 1, columns: [], rows: [] }] };
  assert.throws(() => assertImportAllowed(withDecision, { DISABLE_MEMBER_COMMUNICATIONS_AND_BILLING: 'true' }, 'idoc'), /need your decision/);
  await createUser();
});

test('a preowned Stripe ID skips only its legacy member and preserves billing ownership', async () => {
  const admin = await adminUser();
  const user = await createUser();
  const [profileRow] = await sql`insert into idoc.profiles (user_id, first_name, last_name, address_1, city, state_province, postal_code, country_code) values (${user.id}, 'X', 'Y', '1', 'C', 'S', '1', 'DE') returning id`;
  await sql`insert into idoc.billing_accounts (profile_id, external_customer_id) values (${profileRow.id}, 'cus_ADA')`;
  const { plan: reviewedPlan, report } = reviewed();
  const result = await runLegacyImport({ plan: reviewedPlan, report, snapshot, actorId: admin.id, fileFingerprints: ['a'] });
  assert.equal(result.imported, 2);
  assert.equal(result.skippedExistingBillingReferences, 1);
  assert.deepEqual((await sql`select legacy_id from idoc.migration_map order by legacy_id`).map((row) => row.legacy_id), ['2', '3']);
  const [owned] = await sql`select profile_id from idoc.billing_accounts where external_customer_id = 'cus_ADA'`;
  assert.equal(owned.profile_id, profileRow.id);
});

test('an existing email collision never blocks other members sharing its Stripe customer reference', async () => {
  const admin = await adminUser();
  const [existing] = await sql`insert into idoc.users (email, password_hash, account_state) values ('BEA@example.com', 'keep', 'active') returning id`;
  const { plan: reviewedPlan, report } = reviewed();
  const bea = reviewedPlan.members.find((member) => member.legacyUserId === '2');
  assert.ok(bea);
  bea.stripe.customerId = 'cus_ADA';
  const result = await runLegacyImport({ plan: reviewedPlan, report, snapshot, actorId: admin.id, fileFingerprints: ['a'] });
  assert.equal(result.imported, 2);
  assert.equal(result.skippedExistingAccounts, 1);
  assert.deepEqual((await sql`select legacy_id from idoc.migration_map order by legacy_id`).map((row) => row.legacy_id), ['1', '3']);
  const [unchanged] = await sql`select password_hash, account_state from idoc.users where id = ${existing.id}`;
  assert.equal(unchanged.password_hash, 'keep');
  assert.equal(unchanged.account_state, 'active');
  const [audit] = await sql`select after_json from idoc.audit_log where action = 'admin.legacy_import.import'`;
  assert.equal(audit.after_json.skippedExistingAccountDetails[0].legacyUserId, '2');
  assert.match(audit.after_json.skippedExistingAccountDetails[0].existingAccount, /existing account/);
});
