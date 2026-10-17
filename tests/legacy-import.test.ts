import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMysqlDump, DumpParseError } from '../lib/legacy-import/mysql-dump.ts';
import { checkedKeysFromPhpArray } from '../lib/legacy-import/php-serialized.ts';
import { planLegacyImport, summarizePlan, REQUIRED_LEGACY_TABLES } from '../lib/legacy-import/transform.ts';

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
  const users = insert('psspaceusers', USER_COLUMNS, [
    [1, 'ada', '$P$Babc', 'Ada@Example.com', '2023-01-01 00:00:00', 0, 0, 0],
    [2, 'bea', '$wp$2y$10$abc', 'bea@example.com', '2023-01-01 00:00:00', 0, 0, 0],
    [3, 'cy', '$P$Bdef', 'dup@example.com', '2023-01-01 00:00:00', 0, 0, 0],
    [4, 'di', '$P$Bghi', 'DUP@example.com', '2023-01-01 00:00:00', 0, 0, 0],
    [5, 'ed', 'weird', 'ed@example.com', '2023-01-01 00:00:00', 0, 1, 0],
    [6, 'flo', '$P$Bjkl', 'flo@example.com', '2023-01-01 00:00:00', 0, 0, 0],
  ]);
  const usermeta = insert('psspaceusermeta', META_COLUMNS, [
    ...meta(1, fullProfile),
    // Bea: steward, no address at all, blank federation -> needs onboarding; country cannot be filled.
    ...meta(2, { first_name: 'Bea', last_name: 'B', mepr_official_status_as_steward: 'a:1:{s:28:"fei-dressage-steward-level-3";s:2:"on";}' }),
    // Flo: judge product but steward statuses -> mismatch; country blank but federation present -> filled.
    ...meta(6, { ...fullProfile, 'mepr-address-country': '', mepr_official_status_as_steward: 'a:1:{s:25:"national-dressage-steward";s:2:"on";}', mepr_are_you_a_technical_delegate: '' }),
  ]);
  const transactions = insert('psspace58_mepr_transactions', TX_COLUMNS, [
    [1, '80.00', '80.00', 1, 2042, 'ch_1', 'complete', 'payment', 'ry81hi-42d', 10, '2024-01-01 00:00:00', '2999-01-01 00:00:00'],
    [2, '0.00', '0.00', 1, 2042, 'sub_1', 'confirmed', 'subscription_confirmation', 'ry81hi-42d', 10, '2024-01-01 00:00:00', '0000-00-00 00:00:00'],
    [3, '80.00', '80.00', 2, 2053, 'mp-9', 'complete', 'payment', 'manual', null, '2020-01-01 00:00:00', '2020-06-01 00:00:00'],
    [4, '80.00', '80.00', 6, 2042, 'ch_6', 'complete', 'payment', 'ry81hi-42d', null, '2023-01-01 00:00:00', '2999-01-01 00:00:00'],
    [5, '80.00', '80.00', 6, 2042, 'ch_6', 'failed', 'payment', 'ry81hi-42d', null, '2023-02-01 00:00:00', '2999-01-01 00:00:00'],
    [6, '80.00', '80.00', 99, 2042, 'ch_99', 'complete', 'payment', 'ry81hi-42d', null, '2023-01-01 00:00:00', '2999-01-01 00:00:00'],
  ]);
  const subscriptions = insert('psspace58_mepr_subscriptions', SUB_COLUMNS, [
    [9, 1, 2042, 'sub_old', 'cancelled', '2022-01-01 00:00:00'],
    [10, 1, 2042, 'sub_new', 'active', '2024-01-01 00:00:00'],
    [11, 6, 2042, 'sub_a', 'active', '2023-01-01 00:00:00'],
    [12, 6, 2042, 'sub_b', 'active', '2024-01-01 00:00:00'],
  ]);
  return parseMysqlDump(users + usermeta + transactions + subscriptions, REQUIRED_LEGACY_TABLES);
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
  assert.equal(bea.payments[0].source, 'manual');
  assert.equal(bea.held, false, 'an incomplete profile is imported and sent through onboarding, never held');

  for (const id of ['3', '4']) {
    assert.ok(byId.get(id)!.exceptions.includes('duplicate_email'));
    assert.equal(byId.get(id)!.held, true);
  }
  const ed = byId.get('5')!;
  assert.ok(ed.exceptions.includes('user_flagged_deleted_or_spam') && ed.exceptions.includes('unsupported_password_hash') && ed.held);

  const flo = byId.get('6')!;
  assert.ok(flo.notes.includes('country_filled_from_federation') && flo.notes.includes('technical_delegate_defaulted_no'));
  assert.equal(flo.profile.countryCode, 'US');
  assert.ok(flo.exceptions.includes('product_profile_mismatch'));
  assert.ok(flo.exceptions.includes('multiple_active_subscriptions'));
  assert.equal(flo.stripe.subscriptionId, null, 'two active subscriptions are never resolved silently');
  assert.equal(flo.payments.length, 1, 'a failed payment never counts');

  assert.deepEqual(plan.orphanPaymentUserIds, ['99']);
});

test('summarizePlan reports aggregate counts and ids only', () => {
  const report = summarizePlan(planLegacyImport(buildDump(), { asOf: '2026-10-16' }));
  assert.equal(report.legacyUsers, 6);
  assert.equal(report.held, 3);
  assert.equal(report.importable, 3);
  assert.deepEqual(report.membershipStatus, { active: 2, expired: 1 });
  assert.equal(report.profile.needsOnboarding, 1);
  assert.equal(report.orphans.paymentUsers, 1);
  const serialized = JSON.stringify(report);
  for (const secret of ['example.com', '$P$', '$wp$', 'cus_AAA', 'sub_new', 'ch_1', 'Ada', 'Lovelace']) {
    assert.equal(serialized.includes(secret), false, `report must not contain ${secret}`);
  }
  assert.equal(report.exceptions.find((e) => e.code === 'duplicate_email')?.count, 2);
});
