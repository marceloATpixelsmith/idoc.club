import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMysqlDump, DumpParseError } from '../lib/legacy-import/mysql-dump.ts';
import { checkedKeysFromPhpArray } from '../lib/legacy-import/php-serialized.ts';
import { reduceDumpText, isNeededLegacyTable } from '../lib/legacy-import/reduce-dump.ts';
import { planLegacyImport, summarizePlan, resolveLegacyTables } from '../lib/legacy-import/transform.ts';

const q = (value: string | number | null) => (value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`);
const insert = (table: string, columns: string[], rows: Array<Array<string | number | null>>) =>
  `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES\n${rows.map((r) => `(${r.map(q).join(',\t')})`).join(',\n')};\n`;

const USER_COLUMNS = ['ID', 'user_login', 'user_pass', 'user_email', 'user_registered', 'user_status', 'spam', 'deleted'];
const META_COLUMNS = ['umeta_id', 'user_id', 'meta_key', 'meta_value'];
const TX_COLUMNS = ['id', 'amount', 'total', 'user_id', 'product_id', 'trans_num', 'status', 'txn_type', 'gateway', 'subscription_id', 'created_at', 'expires_at'];
const SUB_COLUMNS = ['id', 'user_id', 'product_id', 'subscr_id', 'status', 'created_at'];

let metaId = 0;
const meta = (userId: number, values: Record<string, string>) => Object.entries(values).map(([key, value]) => [++metaId, userId, key, value]);
const fullProfile = {
  first_name: 'Ada', last_name: 'Lovelace', 'mepr-address-one': '1 Main St', 'mepr-address-city': 'Town', 'mepr-address-state': 'ST',
  'mepr-address-zip': '12345', 'mepr-address-country': 'US', mepr_national_federation: 'us', mepr_idoc_region: 'north-america',
  mepr_fei_number: '10001', mepr_official_status_as_judge: 'a:1:{s:25:"national-grand-prix-judge";s:2:"on";}',
  mepr_are_you_a_technical_delegate: 'yes', '_mepr_stripe_customer_id_ry81hi-42d_EUR': 'cus_AAA',
};

function buildDump() {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const emails: Record<number, string> = {
    1: 'Ada@Example.com', 2: 'bea@example.com', 3: 'dup@example.com', 4: 'DUP@example.com', 5: 'ed@example.com', 6: 'flo@example.com', 7: 'member@',
    8: 'hal@example.com', 9: 'ivy@example.com', 10: 'jon@example.com', 11: 'kim@example.com', 12: 'dup@example.com', 13: 'solo@example.com', 14: 'solo@example.com',
  };
  const hashes: Record<number, string> = { 5: 'weird' };
  const users = insert('psspaceusers', USER_COLUMNS, ids.map((id) => [
    id, `user${id}`, hashes[id] ?? (id === 2 ? '$wp$2y$10$abc' : `$P$B${id}`), emails[id], '2023-01-01 00:00:00', 0, id === 5 ? 1 : 0, 0,
  ]));
  const usermeta = insert('psspaceusermeta', META_COLUMNS, [
    ...meta(1, fullProfile),
    // Bea: steward, no address at all, blank federation -> needs onboarding; country cannot be filled.
    ...meta(2, { first_name: 'Bea', last_name: 'B', mepr_official_status_as_steward: 'a:1:{s:28:"fei-dressage-steward-level-3";s:2:"on";}' }),
    // Flo: judge product but steward statuses -> mismatch; country blank but federation present -> filled.
    ...meta(6, { ...fullProfile, 'mepr-address-country': '', mepr_official_status_as_steward: 'a:1:{s:25:"national-dressage-steward";s:2:"on";}', mepr_are_you_a_technical_delegate: '' }),
  ]);
  const pay = (txId: number, userId: number, ref: string, status: string, created: string, expires: string, product = 2042) =>
    [txId, '80.00', '80.00', userId, product, ref, status, 'payment', 'ry81hi-42d', null, created, expires];
  const transactions = insert('psspace58_mepr_transactions', TX_COLUMNS, [
    pay(1, 1, 'ch_1', 'complete', '2024-01-01 00:00:00', '2999-01-01 00:00:00'),
    [2, '0.00', '0.00', 1, 2042, 'sub_1', 'confirmed', 'subscription_confirmation', 'ry81hi-42d', 10, '2024-01-01 00:00:00', '0000-00-00 00:00:00'],
    [3, '80.00', '80.00', 2, 2053, 'mp-9', 'complete', 'payment', 'manual', null, '2025-09-01 00:00:00', '2026-09-01 00:00:00'],
    pay(4, 6, 'ch_6', 'complete', '2023-01-01 00:00:00', '2999-01-01 00:00:00'),
    pay(5, 6, 'ch_6f', 'failed', '2023-02-01 00:00:00', '2999-01-01 00:00:00'),
    pay(6, 99, 'ch_99', 'complete', '2023-01-01 00:00:00', '2999-01-01 00:00:00'),
    pay(7, 7, 'ch_7', 'complete', '2023-01-01 00:00:00', '2999-01-01 00:00:00'),
    pay(8, 7, 'ch_8', 'failed', '2023-01-01 00:00:00', '2999-01-01 00:00:00'),
    pay(9, 3, 'ch_3', 'complete', '2023-01-01 00:00:00', '2999-01-01 00:00:00'),
    pay(10, 4, 'ch_4', 'complete', '2023-01-01 00:00:00', '2999-01-01 00:00:00'),
    pay(11, 5, 'ch_5', 'complete', '2023-01-01 00:00:00', '2999-01-01 00:00:00'),
    // Expired for more than a year (Hal), exactly one year before the as-of date (Jon: removed), one day inside the year (Kim: kept).
    pay(12, 8, 'ch_12', 'complete', '2023-01-01 00:00:00', '2025-01-01 00:00:00'),
    pay(13, 10, 'ch_13', 'complete', '2023-01-01 00:00:00', '2025-10-16 00:00:00'),
    pay(14, 11, 'ch_14', 'complete', '2023-01-01 00:00:00', '2025-10-17 00:00:00'),
    pay(15, 13, 'ch_15', 'complete', '2023-01-01 00:00:00', '2999-01-01 00:00:00'),
    // Orphans: 97 paid long ago and 96 never completed a payment (both removed by the rules); 98 has an active subscription (always reviewed).
    pay(17, 97, 'ch_17', 'complete', '2019-01-01 00:00:00', '2020-01-01 00:00:00'),
    pay(18, 96, 'ch_18', 'failed', '2023-01-01 00:00:00', '2999-01-01 00:00:00'),
    // Ivy, Lee (12) and Ned (14) never paid.
    pay(16, 9, 'ch_16', 'failed', '2023-01-01 00:00:00', '2999-01-01 00:00:00'),
  ]);
  const subscriptions = insert('psspace58_mepr_subscriptions', SUB_COLUMNS, [
    [9, 1, 2042, 'sub_old', 'cancelled', '2022-01-01 00:00:00'],
    [10, 1, 2042, 'sub_new', 'active', '2024-01-01 00:00:00'],
    [11, 6, 2042, 'sub_a', 'active', '2023-01-01 00:00:00'],
    [12, 6, 2042, 'sub_b', 'active', '2024-01-01 00:00:00'],
    [13, 98, 2042, 'sub_orphan', 'active', '2024-01-01 00:00:00'],
    [14, 8, 2042, 'sub_hal', 'active', '2022-01-01 00:00:00'],
  ]);
  return parseMysqlDump(users + usermeta + transactions + subscriptions, isNeededLegacyTable);
}

test('dump reader handles escapes, doubled quotes, NULL, tabs and statements without a column list', () => {
  const sql = [
    'CREATE TABLE `t` (\n  `a` int(11) NOT NULL,\n  `b` text DEFAULT NULL,\n  PRIMARY KEY (`a`)\n) ENGINE=InnoDB;',
    "INSERT INTO `t` VALUES\n(1,\t'it''s, (ok); \\\\ \\'x\\'\\n'),\n(2,\tNULL);",
    "INSERT INTO `other` (`a`) VALUES (7);",
  ].join('\n');
  const rows = parseMysqlDump(sql).get('t')!;
  assert.deepEqual(rows, [{ a: '1', b: "it's, (ok); \\ 'x'\n" }, { a: '2', b: null }]);
  assert.equal(parseMysqlDump(sql, new Set(['t'])).has('other'), false);
});

test('dump reader errors never contain row content', () => {
  assert.throws(() => parseMysqlDump("INSERT INTO `t` (`a`) VALUES ('secret-value'"), (error: unknown) => error instanceof DumpParseError && !/secret-value/.test(String((error as Error).message)));
  assert.throws(() => parseMysqlDump("INSERT INTO `t` (`a`, `b`) VALUES (1)"), DumpParseError);
});

test('checkedKeysFromPhpArray reads only the checked keys of the MemberPress array shape', () => {
  assert.deepEqual(checkedKeysFromPhpArray('a:2:{s:5:"other";s:2:"on";s:16:"retired-official";s:2:"on";}'), ['other', 'retired-official']);
  assert.deepEqual(checkedKeysFromPhpArray('a:0:{}'), []);
  assert.equal(checkedKeysFromPhpArray('a:1:{s:9:"abc";s:2:"on";}'), null);
  assert.equal(checkedKeysFromPhpArray('garbage'), null);
  assert.equal(checkedKeysFromPhpArray(null), null);
});

test('planLegacyImport applies the agreed rules', () => {
  const plan = planLegacyImport(buildDump(), { asOf: '2026-10-16' });
  const byId = new Map(plan.members.map((member) => [member.legacyUserId, member]));

  const ada = byId.get('1')!;
  assert.equal(ada.classification, 'judge');
  assert.equal(ada.email, 'ada@example.com');
  assert.equal(ada.hashFormat, 'phpass');
  assert.deepEqual(ada.missingFields, []);
  assert.equal(ada.membership.status, 'active');
  assert.equal(ada.membership.paidThrough, '2999-01-01');
  assert.equal(ada.exclusion, null);
  assert.equal(ada.stripe.customerId, 'cus_AAA');
  assert.equal(ada.stripe.subscriptionId, 'sub_new', 'the newest active subscription is the live one');
  assert.deepEqual(ada.exceptions, []);
  assert.deepEqual(ada.roles[0], {
    roleType: 'judge', nationalFederationCountryCode: 'US', idocRegion: 'North America', feiId: '10001',
    officialStatuses: ['National Senior Officials / Candidates from EEFs education system FEI'], isTechnicalDelegate: true,
  });
  assert.equal(ada.payments.length, 1, 'only the completed payment is planned, not the zero-amount confirmation');

  const bea = byId.get('2')!;
  assert.equal(bea.classification, 'steward');
  assert.equal(bea.hashFormat, 'wp_bcrypt');
  assert.deepEqual(bea.roles[0].officialStatuses, ['FEI Dressage Steward Level 3/4'], 'steward Level 3 maps to Level 3/4');
  assert.ok(bea.exceptions.includes('incomplete_profile'));
  assert.ok(bea.missingFields.includes('address1') && bea.missingFields.includes('steward.idocRegion'));
  assert.equal(bea.membership.status, 'expired');
  assert.equal(bea.exclusion, null, 'expired for only about six weeks: still imported');
  assert.equal(bea.payments[0].source, 'manual');
  assert.equal(bea.held, false, 'an incomplete profile is imported and sent through onboarding, never held');

  for (const id of ['3', '4']) {
    assert.ok(byId.get(id)!.exceptions.includes('duplicate_email'));
    assert.equal(byId.get(id)!.held, true);
  }
  assert.equal(byId.get('13')!.exceptions.includes('duplicate_email'), false, 'a duplicate that is removed by a cleanup rule is not a duplicate');
  const ed = byId.get('5')!;
  assert.ok(ed.exceptions.includes('user_flagged_deleted_or_spam') && ed.exceptions.includes('unsupported_password_hash') && ed.held);

  const flo = byId.get('6')!;
  assert.ok(flo.notes.includes('country_filled_from_federation') && flo.notes.includes('technical_delegate_defaulted_no'));
  assert.equal(flo.profile.countryCode, 'US');
  assert.ok(flo.exceptions.includes('product_profile_mismatch'));
  assert.ok(flo.exceptions.includes('multiple_active_subscriptions'));
  assert.equal(flo.stripe.subscriptionId, null, 'two active subscriptions are never resolved silently');
  assert.equal(flo.payments.length, 1, 'a failed payment never counts');

  assert.ok(byId.get('7')!.exceptions.includes('invalid_email') && byId.get('7')!.held, 'an address the application would reject is held');

  // Cleanup rules.
  assert.equal(byId.get('8')!.exclusion, 'expired_over_a_year');
  assert.equal(byId.get('10')!.exclusion, 'expired_over_a_year', 'exactly one year ago counts as a year or more');
  assert.equal(byId.get('11')!.exclusion, null, 'one day inside the year is kept');
  assert.equal(byId.get('11')!.membership.status, 'expired');
  for (const id of ['9', '12', '14']) assert.equal(byId.get(id)!.exclusion, 'never_paid', `user ${id} has no completed payment`);

  assert.deepEqual(plan.orphanPaymentUserIds, ['96', '97', '99']);
  assert.deepEqual(plan.orphanSubscriptionUserIds, ['98']);
  assert.deepEqual(plan.orphans.map((orphan) => [orphan.legacyUserId, orphan.hasActiveSubscription]), [['96', false], ['97', false], ['98', true], ['99', false]]);
});

test('summarizePlan leaves removed members out of every figure and separates expected from review', () => {
  const report = summarizePlan(planLegacyImport(buildDump(), { asOf: '2026-10-16' }));
  assert.equal(report.legacyUsers, 14);
  assert.equal(report.removedByRules, 5);
  assert.equal(report.inScope, 9);
  assert.equal(report.held, 4);
  assert.equal(report.importable, 5);
  assert.deepEqual(report.excluded.map((item) => [item.key, item.count]), [['expired_over_a_year', 2], ['never_paid', 3]]);
  assert.deepEqual(report.membershipStatus, { active: 3, expired: 2 });
  assert.equal(report.profile.needsOnboarding, 3);
  assert.equal(report.payments.paid, 5, 'payments of held and removed members are not counted');
  assert.equal(report.payments.ignoredFailedOrPending, 1);
  assert.equal(report.stripe.withActiveSubscription, 1, 'the removed member with an active subscription is not counted');
  assert.deepEqual(report.subscriptionsByStatus, { active: 3, cancelled: 1 });

  const expected = new Map(report.expected.map((item) => [item.key, item]));
  const review = new Map(report.review.map((item) => [item.key, item]));
  assert.equal(expected.get('incomplete_profile')?.count, 7, 'removed members are not counted as incomplete');
  assert.ok(expected.get('incomplete_profile')?.remedy);
  assert.ok(expected.has('country_filled_from_federation') && expected.has('unsupported_password_hash'));
  assert.equal(review.get('duplicate_email')?.count, 2);
  assert.ok(review.has('multiple_active_subscriptions') && review.has('invalid_email'));
  assert.equal(review.has('no_account_record'), false, 'people with no account are deleted people: handled, not a decision');
  const orphans = expected.get('no_account_record')!;
  assert.deepEqual(orphans.rows.map((row) => row.legacy_user_id), ['96', '97', '98', '99']);
  assert.match(orphans.remedy ?? '', /1 still show an active subscription/);
  assert.equal(review.has('incomplete_profile'), false);
  assert.equal(expected.has('duplicate_email'), false);

  // Every group carries one downloadable row per person, with the columns declared for it.
  const dup = review.get('duplicate_email')!;
  assert.equal(dup.rows.length, 2);
  assert.ok(dup.rows.every((row) => dup.columns.every((column) => column in row)));
  assert.deepEqual(dup.rows.map((row) => row.email).sort(), ['dup@example.com', 'dup@example.com']);
  assert.equal(report.excluded[1].rows.length, 3);

  // People's details may be downloaded, but never password hashes or Stripe payment references.
  const serialized = JSON.stringify(report);
  for (const secret of ['$P$', '$wp$', 'weird', 'ch_1', 'mp-9']) assert.equal(serialized.includes(secret), false, `report must not contain ${secret}`);
});

test('reduceDumpText keeps only the needed tables and parses identically afterwards', () => {
  const sql = [
    '-- comment', '/*!40101 SET NAMES utf8 */;', 'DROP TABLE IF EXISTS `psspaceusers`;',
    'CREATE TABLE `psspaceusers` (\n  `ID` int,\n  `user_login` text\n) ENGINE=InnoDB;',
    'LOCK TABLES `psspaceusers` WRITE;',
    "INSERT INTO `psspaceusers` (`ID`, `user_login`) VALUES\n(1,\t'a;'),\n(2,\t'it''s);'),\n(3,\tNULL);",
    'CREATE TABLE `psspace58_mepr_events` (\n  `id` int\n) ENGINE=InnoDB;',
    "INSERT INTO `psspace58_mepr_events` (`id`) VALUES\n(1),\n(2);",
    'CREATE TABLE `psspaceusermeta` (\n  `umeta_id` int,\n  `user_id` int,\n  `meta_key` text,\n  `meta_value` text\n) ENGINE=InnoDB;',
    "INSERT INTO `psspaceusermeta` VALUES (1,1,'k','v'),(2,1,'k2',NULL);",
    "INSERT INTO `psspace58_mepr_events` (`id`) VALUES (9);",
    'UNLOCK TABLES;',
  ].join('\n') + '\n';
  const needed = isNeededLegacyTable;
  const reduced = reduceDumpText(sql, needed);
  assert.equal(reduced.includes('psspace58_mepr_events'), false);
  assert.equal(reduced.includes('LOCK TABLES'), false);
  assert.deepEqual(parseMysqlDump(reduced, needed), parseMysqlDump(sql, needed));
  assert.equal(parseMysqlDump(reduced, needed).get('psspaceusers')!.length, 3);
  assert.equal(reduceDumpText('nothing here', needed), '');
});

test('tables are detected by role whatever the prefix, using the largest match', () => {
  const sql = [
    "CREATE TABLE `wp_users` (\n  `ID` int\n) ENGINE=InnoDB;", "INSERT INTO `wp_users` (`ID`) VALUES (1),(2),(3);",
    "CREATE TABLE `old_users` (\n  `ID` int\n) ENGINE=InnoDB;", "INSERT INTO `old_users` (`ID`) VALUES (1);",
    "INSERT INTO `wp_usermeta` (`user_id`) VALUES (1);",
    "INSERT INTO `wp_mepr_transactions` (`id`) VALUES (1);",
    "INSERT INTO `wp_mepr_subscriptions` (`id`) VALUES (1);",
    "INSERT INTO `wp_mepr_events` (`id`) VALUES (1);",
  ].join('\n') + '\n';
  const resolved = resolveLegacyTables(parseMysqlDump(reduceDumpText(sql, isNeededLegacyTable), isNeededLegacyTable));
  assert.deepEqual(resolved.missing, []);
  assert.equal(resolved.tables.users, 'wp_users');
  assert.equal(resolved.tables.transactions, 'wp_mepr_transactions');
  assert.equal(resolved.found.some((f) => f.table === 'wp_mepr_events'), false);
  assert.equal(resolved.found.find((f) => f.table === 'old_users')!.used, false);
});
