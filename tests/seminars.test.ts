import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { computeSeminarAvailability, initialPaymentStatusForMethod, registrationDisplayLabel } from '../lib/seminars/status.ts';
import { isValidIanaTimeZone, zonedDateTimeToUtc } from '../lib/seminars/timezone.ts';

const seminarsSource = readFileSync('lib/seminars/seminars.ts', 'utf8');
const registrationsSource = readFileSync('lib/seminars/registrations.ts', 'utf8');
const checkoutSource = readFileSync('lib/seminars/checkout.ts', 'utf8');
const adminActions = readFileSync('app/(dashboard)/admin/seminars/actions.ts', 'utf8');
const memberActions = readFileSync('app/(dashboard)/dashboard/seminars/actions.ts', 'utf8');
const migration = readFileSync('lib/db/migrations/0041_seminars.sql', 'utf8');
const exportRoute = readFileSync('app/api/admin/export/seminar-registrations/route.ts', 'utf8');
const memberPage = readFileSync('components/seminars/member-registrations.tsx', 'utf8');

test('seminar and registration states, and their documented length/value limits, are constrained in the migration', () => {
  assert.match(migration, /"status" in \('draft', 'published', 'canceled'\)/);
  assert.match(migration, /"registration_status" in \('registered', 'canceled'\)/);
  assert.match(migration, /"payment_status" in \('unpaid', 'bank_transfer_pending', 'cash_pending', 'paid'\)/);
  assert.match(migration, /char_length\("idoc"\."seminars"\."title"\) between 1 and 200/);
  assert.match(migration, /char_length\("idoc"\."seminars"\."description"\) between 1 and 10000/);
  assert.match(migration, /char_length\("idoc"\."seminars"\."location"\) between 1 and 2000/);
  assert.match(migration, /"idoc"\."seminars"\."capacity" > 0/);
  assert.match(migration, /"idoc"\."seminars"\."price_cents" >= 0/);
  assert.match(migration, /"idoc"\."seminars"\."end_time" > "idoc"\."seminars"\."start_time"/);
});

test('capacity and duplicate-registration races are enforced by a unique constraint and a row lock, not application memory alone', () => {
  assert.match(migration, /CONSTRAINT "seminar_registrations_seminar_profile_unique" UNIQUE|CREATE UNIQUE INDEX "seminar_registrations_seminar_profile_unique"/);
  assert.match(registrationsSource, /for update/);
  assert.match(registrationsSource, /client\.begin\(async \(sql\) => \{/);
});

test('registration payment methods reference the same canonical seminar_payment_methods identities Organization Settings owns', () => {
  assert.match(migration, /REFERENCES "idoc"."seminar_payment_methods"\("canonical_id"\)/);
  assert.match(seminarsSource, /'online_stripe', 'bank_transfer', 'cash_event'/);
});

test('every admin-facing seminar and registration function re-authorizes as an administrator server-side', () => {
  for (const source of [seminarsSource, registrationsSource]) {
    assert.match(source, /requireAccountAccess\('administration'\)/);
    assert.match(source, /requireAdministrator\(actor\)/);
  }
});

test('member-facing registration functions derive the actor\'s own profile server-side and never accept a submitted profile id', () => {
  assert.match(registrationsSource, /requireAccountAccess\('member'\)/);
  assert.doesNotMatch(registrationsSource, /input\.profileId|profileId: unknown/);
});

test('price and payment method become immutable once a seminar has any registration', () => {
  assert.match(seminarsSource, /price cannot change once a seminar has registrations/i);
  assert.match(seminarsSource, /payment method cannot change once a seminar has registrations/i);
  assert.match(seminarsSource, /totalCount > 0/);
});

test('capacity cannot be reduced below the current count of active registrations', () => {
  assert.match(seminarsSource, /fields\.capacity < activeCount/);
  assert.match(seminarsSource, /registration_status='registered'/);
});

test('seminar creation, edits, status changes, and registration/payment mutations are all audited', () => {
  for (const action of ['admin.seminar.created', 'admin.seminar.edited', 'admin.seminar.status_changed']) {
    assert.match(seminarsSource, new RegExp(action.replaceAll('.', '\\.')));
  }
  for (const action of ['member.seminar_registration.registered', 'member.seminar_registration.canceled', 'admin.seminar_registration.payment_marked_paid']) {
    assert.match(registrationsSource, new RegExp(action.replaceAll('.', '\\.')));
  }
});

test('every admin Server Action requires CSRF evidence before any mutation, directly or through the shared run() helper', () => {
  const runHelper = adminActions.match(/async function run\([\s\S]*?\n\}/)?.[0];
  assert.ok(runHelper); assert.match(runHelper as string, /requireCsrfToken\(/);
  for (const name of ['createSeminarAction', 'updateSeminarAction', 'publishSeminarAction', 'cancelSeminarAction', 'revertSeminarToDraftAction', 'markSeminarRegistrationPaidAction']) {
    const fn = adminActions.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(fn, `${name} not found`);
    assert.ok(/requireCsrfToken\(/.test(fn as string) || /\brun\(/.test(fn as string), `${name} must call requireCsrfToken directly or via run()`);
  }
});

test('every member Server Action requires CSRF evidence before any mutation', () => {
  for (const name of ['registerForSeminarAction', 'cancelSeminarRegistrationAction']) {
    const fn = memberActions.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(fn, `${name} not found`);
    assert.match(fn as string, /requireCsrfToken\(/);
  }
});

test('seminar payments are classified separately from membership billing: the checkout module never imports the membership/payment-ledger schema tables', () => {
  assert.doesNotMatch(checkoutSource, /from '@\/lib\/db\/schema'/);
  assert.match(checkoutSource, /kind: 'seminar_registration'/);
});

test('the CSV export route exposes only the documented columns and is BOM-prefixed for spreadsheet compatibility', () => {
  assert.match(exportRoute, /toCsv\(rows, \['seminar_title', 'member_name', 'member_email', 'registration_status', 'payment_status', 'expected_amount_cents', 'currency', 'refund_ids', 'refunded_amount_cents', 'registered_at', 'canceled_at', 'paid_at'\]\)/);
  // Either source spelling of the BOM (a literal embedded character, or a six-character JS unicode
  // escape sequence spelling out code point 0xfeff -- the convention the other four admin CSV
  // export routes use) is correct: both produce the same runtime character before Excel ever sees
  // the response body.
  const bom = String.fromCharCode(0xfeff);
  const escapeSequenceSpelling = '`' + String.fromCharCode(92, 117, 70, 69, 70, 70) + '${toCsv';
  assert.ok(exportRoute.includes(`\`${bom}$\{toCsv`) || exportRoute.includes(escapeSequenceSpelling), 'the response body must be BOM-prefixed for spreadsheet compatibility');
  assert.doesNotMatch(exportRoute, /stripe_payment_intent_id|stripe_checkout_session_id|password|marked_paid_by_user_id/);
});

test('bank transfer instructions are rendered only from the pre-sanitized organization-wide field, re-sanitized again before render', () => {
  assert.match(memberPage, /sanitizeBankInstructions/);
  assert.match(memberPage, /dangerouslySetInnerHTML/);
});

test('zonedDateTimeToUtc correctly accounts for daylight saving time using only built-in Intl (no date-library dependency)', () => {
  assert.equal(zonedDateTimeToUtc('2026-01-15', '10:00:00', 'Europe/Berlin').toISOString(), '2026-01-15T09:00:00.000Z');
  assert.equal(zonedDateTimeToUtc('2026-07-15', '10:00:00', 'Europe/Berlin').toISOString(), '2026-07-15T08:00:00.000Z');
  assert.equal(isValidIanaTimeZone('Europe/Berlin'), true);
  assert.equal(isValidIanaTimeZone('Not/AZone'), false);
});

test('computeSeminarAvailability derives draft, canceled, past, closed, full, and open from status/deadline/capacity/end time', () => {
  const base = { activeRegistrationCount: 0, capacity: 10, endsAtUtc: new Date('2030-01-01T00:00:00Z'), registrationDeadline: '2029-12-31T00:00:00Z', status: 'published' as const };
  const now = new Date('2025-01-01T00:00:00Z');
  assert.equal(computeSeminarAvailability({ ...base, status: 'draft' }, now), 'draft');
  assert.equal(computeSeminarAvailability({ ...base, status: 'canceled' }, now), 'canceled');
  assert.equal(computeSeminarAvailability(base, new Date('2031-01-01T00:00:00Z')), 'past');
  assert.equal(computeSeminarAvailability(base, new Date('2030-12-31T00:00:00Z')), 'past');
  assert.equal(computeSeminarAvailability(base, new Date('2029-12-31T12:00:00Z')), 'closed');
  assert.equal(computeSeminarAvailability({ ...base, activeRegistrationCount: 10 }, now), 'full');
  assert.equal(computeSeminarAvailability(base, now), 'open');
});

test('registrationDisplayLabel prioritizes Canceled over any stale payment status, and otherwise shows the payment status', () => {
  assert.equal(registrationDisplayLabel('canceled', 'paid'), 'Canceled');
  assert.equal(registrationDisplayLabel('registered', 'paid'), 'Paid');
  assert.equal(registrationDisplayLabel('registered', 'bank_transfer_pending'), 'Bank transfer pending');
  assert.equal(registrationDisplayLabel('registered', 'cash_pending'), 'Cash pending');
  assert.equal(registrationDisplayLabel('registered', 'unpaid'), 'Unpaid');
});

test('the member Seminars page renders registration and payment status labels', () => {
  assert.match(memberPage, /registrationDisplayLabel/);
  const statusSource = readFileSync('lib/seminars/status.ts', 'utf8');
  for (const label of ['Canceled', 'Registration closed', 'Full', 'Open', 'Past', 'Bank transfer pending', 'Cash pending', 'Paid', 'Unpaid']) {
    assert.ok(statusSource.includes(label), `label "${label}" is not defined in lib/seminars/status.ts`);
  }
});

test('the member Seminars page separates prominent current registrations, available seminars, and past registrations', () => {
  for (const label of ['Your upcoming and current registrations', 'Available seminars', 'Past']) {
    assert.match(memberPage, new RegExp(label));
  }
  assert.match(memberPage, /const registered/);
  assert.match(memberPage, /const available/);
});

test('the admin edit page offers Publish, Cancel, and Move-to-draft quick actions, and a "Mark paid" control per unpaid registration', () => {
  const adminEditPage = readFileSync('app/(dashboard)/admin/seminars/[id]/page.tsx', 'utf8');
  assert.match(adminEditPage, /publishSeminarAction/);
  assert.match(adminEditPage, /cancelSeminarAction/);
  assert.match(adminEditPage, /revertSeminarToDraftAction/);
  assert.match(adminEditPage, /markSeminarRegistrationPaidAction/);
});

test('the admin seminar list page supports search and status filtering', () => {
  const adminListPage = readFileSync('app/(dashboard)/admin/seminars/page.tsx', 'utf8');
  assert.match(adminListPage, /name="q"/);
  assert.match(adminListPage, /name="status"/);
});

test('the admin seminar table provides Tablecn-style date, sorting, pagination, and visibility controls', () => {
  const page = readFileSync('app/(dashboard)/admin/seminars/page.tsx', 'utf8');
  const controls = readFileSync('components/admin/table-controls.tsx', 'utf8');
  for (const value of ['name="from"', 'name="to"', 'ActiveFilterChips', 'ColumnVisibility', 'sortHref', 'page']) assert.match(page, new RegExp(value));
  assert.match(controls, /Clear all/);
  assert.match(seminarsSource, /s\.seminar_date desc,s\.id desc/);
});

test('Seminars is removed from the member dashboard and retained on the public website', () => {
  const dashboardTabs = readFileSync('app/(dashboard)/dashboard/dashboard-tabs.tsx', 'utf8');
  const publicPage = readFileSync('app/(marketing)/seminars/page.tsx', 'utf8');
  assert.doesNotMatch(dashboardTabs, /\/dashboard\/seminars/);
  assert.match(publicPage, /MemberRegistrations/);
});

test('initialPaymentStatusForMethod maps each canonical payment method to its own starting payment status', () => {
  assert.equal(initialPaymentStatusForMethod('online_stripe'), 'unpaid');
  assert.equal(initialPaymentStatusForMethod('bank_transfer'), 'bank_transfer_pending');
  assert.equal(initialPaymentStatusForMethod('cash_event'), 'cash_pending');
});
