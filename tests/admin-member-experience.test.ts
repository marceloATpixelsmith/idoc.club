import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MANUAL_PAYMENT_SOURCES, PAYMENT_SOURCE_LABELS } from '../lib/payments/pricing.ts';
import { CATEGORY_LABELS, SUPPORT_CATEGORIES } from '../lib/support/inbox-options.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('lib/db/migrations/0072_seminar_approval_directory_optin_support_suggestion.sql');

test('manual membership payments offer Stripe instead of PayPal and label the single evidence field', () => {
  assert.deepEqual([...MANUAL_PAYMENT_SOURCES], ['stripe_manual', 'bank_transfer', 'cash', 'complimentary']);
  assert.equal(PAYMENT_SOURCE_LABELS.stripe_manual, 'Stripe');
  const form = read('app/(dashboard)/admin/payments/manual-payment-form.tsx');
  assert.match(form, /Stripe Payment ID \/ Bank Transfer Reference/);
  assert.doesNotMatch(form, /Reference \/ evidence|PayPal/);
  const server = read('lib/payments/manual-payments.ts');
  assert.match(server, /REFERENCE_REQUIRED_SOURCES: readonly ManualPaymentSource\[\] = \['stripe_manual', 'bank_transfer'\]/);
  assert.match(server, /membership\.manual_payment_recorded/);
  assert.match(server, /input\.source !== 'complimentary' && membershipRow\.status === 'active'/);
  assert.match(migration, /"source" in \('stripe_recurring', 'stripe_one_time', 'stripe_manual', 'paypal', 'bank_transfer', 'cash', 'complimentary'\)/);
  const notices = read('lib/notifications/renewal-notices.ts');
  assert.match(notices, /'membership\.manual_payment_recorded',/);
  assert.match(notices, /Your membership is fully paid/);
});

test('Membership Revenue defaults to all time, can always pick a new first date, and filters by All, Stripe, Bank Transfer and Cash', () => {
  const filters = read('app/(dashboard)/admin/revenue/revenue-filters.tsx');
  assert.match(filters, /'All time'/);
  for (const label of ['All', 'Stripe', 'Bank Transfer', 'Cash']) assert.match(filters, new RegExp(`label: '${label}'`));
  assert.match(filters, /Payment source/);
  // A click on an already-complete range restarts the range at the clicked day (the first date was unpickable before).
  assert.match(filters, /if \(range\.from && range\.to\) setRange\(\{ from: trigger, to: undefined \}\)/);
  assert.doesNotMatch(filters, /Origin|manual'/);
  const report = read('lib/payments/revenue-report.ts');
  assert.match(report, /if \(!rawFrom && !rawTo\) return \{ from: null, to: null \}/);
  assert.doesNotMatch(report, /getUTCMonth\(\) - 11/);
});

test('the Members table has an Official Status filter covering every Judge and Steward status', () => {
  const table = read('app/(dashboard)/admin/members/members-table.tsx');
  const validation = read('lib/membership/validation.ts');
  assert.match(table, /label: 'Official Status'/);
  assert.match(table, /JUDGE_STATUSES\.map/);
  assert.match(table, /STEWARD_STATUSES\.map/);
  assert.match(table, /officialStatus: filterToken\(state\.columnFilters, 'officialStatus'\)/);
  const server = read('lib/membership/admin-memberships.ts');
  assert.match(server, /OFFICIAL_STATUS_OPTIONS/);
  assert.match(server, /= any\(opr\.official_statuses\)/);
  assert.match(read('lib/admin/table-preferences.ts'), /officialStatus: multiToken\(OFFICIAL_STATUS_VALUES/);
  for (const status of ['FEI Dressage Judge 1/2**', 'Para Dressage Judge', 'FEI Dressage Steward Level 1', 'National Dressage Steward']) assert.ok(validation.includes(status));
});

test('Make a suggestion is a support category for members and administrators, enforced by the database', () => {
  assert.ok((SUPPORT_CATEGORIES as readonly string[]).includes('suggestion'));
  assert.match(read('lib/support/inbox.ts'), /SUPPORT_CATEGORIES = \['billing_membership', 'seminars', 'technical_support', 'suggestion', 'other'\] as const/);
  assert.equal(CATEGORY_LABELS.suggestion, 'Make a suggestion');
  assert.match(migration, /support_conversations_category_check"[\s\S]*'technical_support', 'suggestion', 'other'/);
  assert.match(migration, /support_category_defaults_category_check"[\s\S]*'technical_support', 'suggestion', 'other'/);
  assert.match(read('lib/db/schema.ts'), /'technical_support', 'suggestion', 'other'/);
});

test('showing a member email in the directory is an opt-in, default no, with the requested helper text on sign-up and profile', () => {
  const text = 'Opting into showing your email in the directory is a great way for members to be able to get in touch with you for things like judging opportunities etc.';
  for (const path of ['app/(dashboard)/onboarding/onboarding-wizard.tsx', 'app/(dashboard)/dashboard/profile/profile-form.tsx']) {
    const source = read(path);
    assert.ok(source.includes(text), `${path} must carry the helper text`);
    assert.match(source, /name="directoryEmailOptIn" type="checkbox"/);
    assert.doesNotMatch(source, /name="directoryEmailOptIn"[^>]*defaultChecked(?!=\{Boolean)/);
  }
  assert.match(read('app/(dashboard)/onboarding/actions.ts'), /directoryEmailOptIn: formData\.get\('directoryEmailOptIn'\) === 'on'/);
  assert.match(migration, /"directory_email_opt_in" boolean DEFAULT false NOT NULL/);
  assert.match(read('lib/db/schema.ts'), /directoryEmailOptIn: boolean\('directory_email_opt_in'\)\.notNull\(\)\.default\(false\)/);
  // Admin corrections never silently flip the member's own choice: the field is only written when the form carries it.
  assert.match(read('lib/membership/validation.ts'), /formData\.has\('directoryEmailOptInField'\)/);
});
