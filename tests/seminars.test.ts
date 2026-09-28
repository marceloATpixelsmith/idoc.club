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
const guestActions = readFileSync('app/(marketing)/seminars/actions.ts', 'utf8');
const originalMigration = readFileSync('lib/db/migrations/0041_seminars.sql', 'utf8');
const paymentMethodMigration = readFileSync('lib/db/migrations/0055_seminar_registration_payment_method.sql', 'utf8');
const multiDayMigration = readFileSync('lib/db/migrations/0056_seminars_multiday_dual_price_guest.sql', 'utf8');
const exportRoute = readFileSync('app/api/admin/export/seminar-registrations/route.ts', 'utf8');
const seminarFieldset = readFileSync('components/seminars/seminar-fieldset.tsx', 'utf8');
const memberPage = readFileSync('components/seminars/member-registrations.tsx', 'utf8');

test('seminar and registration states, and their documented length limits, are constrained in the migration', () => {
  assert.match(originalMigration, /"status" in \('draft', 'published', 'canceled'\)/);
  assert.match(originalMigration, /"registration_status" in \('registered', 'canceled'\)/);
  assert.match(originalMigration, /char_length\("idoc"\."seminars"\."title"\) between 1 and 200/);
  assert.match(originalMigration, /char_length\("idoc"\."seminars"\."description"\) between 1 and 10000/);
  assert.match(originalMigration, /char_length\("idoc"\."seminars"\."location"\) between 1 and 2000/);
  assert.match(originalMigration, /"idoc"\."seminars"\."capacity" > 0/);
});

test('a seminar\'s start/end date and both its member and non-member prices are constrained non-negative and ordered in the migration', () => {
  assert.match(multiDayMigration, /"end_date" > "start_date" OR \("end_date" = "start_date" AND "end_time" > "start_time"\)/);
  assert.match(multiDayMigration, /"member_price_cents" >= 0/);
  assert.match(multiDayMigration, /"non_member_price_cents" >= 0/);
});

test('a registration belongs to exactly one identity -- a real member profile, or a guest name+email, never both or neither -- enforced by a database check constraint and a partial unique index', () => {
  assert.match(multiDayMigration, /CHECK \(\("profile_id" IS NOT NULL AND "guest_name" IS NULL AND "guest_email" IS NULL\) OR \("profile_id" IS NULL AND "guest_name" IS NOT NULL AND "guest_email" IS NOT NULL\)\)/);
  assert.match(multiDayMigration, /CREATE UNIQUE INDEX "seminar_registrations_seminar_guest_email_unique" ON "idoc"\."seminar_registrations" USING btree \("seminar_id", lower\("guest_email"\)\) WHERE "profile_id" IS NULL/);
});

test('capacity and duplicate-registration races are enforced by a unique constraint and a row lock, not application memory alone', () => {
  assert.match(originalMigration, /CONSTRAINT "seminar_registrations_seminar_profile_unique" UNIQUE|CREATE UNIQUE INDEX "seminar_registrations_seminar_profile_unique"/);
  assert.match(registrationsSource, /for update/);
  assert.match(registrationsSource, /client\.begin\(async \(sql\) => \{/);
});

test('the payment method a registrant chooses is a per-registration column referencing the same canonical seminar_payment_methods identities Organization Settings owns -- not a per-seminar admin choice', () => {
  assert.match(paymentMethodMigration, /ADD COLUMN "payment_method_canonical_id"/);
  assert.match(paymentMethodMigration, /REFERENCES "idoc"\."seminar_payment_methods"\("canonical_id"\)/);
  assert.match(paymentMethodMigration, /ALTER TABLE "idoc"\."seminars" DROP COLUMN "payment_method_canonical_id"/);
  assert.doesNotMatch(seminarsSource, /paymentMethodId|payment_method_canonical_id/);
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

test('a guest can register without an account, identified only by name and email, validated against a real email schema', () => {
  assert.match(registrationsSource, /export async function registerAsGuestForSeminar/);
  assert.match(registrationsSource, /guestEmailSchema = z\.string\(\)\.trim\(\)\.email\(\)/);
  assert.match(registrationsSource, /profile_id is null and lower\(guest_email\)/);
});

test('both prices become immutable once a seminar has any registration, and payment method is no longer a seminar-level concept at all', () => {
  assert.match(seminarsSource, /Prices cannot change once a seminar has registrations/i);
  assert.match(seminarsSource, /totalCount > 0/);
  assert.match(seminarsSource, /memberPriceCents !== existing\.member_price_cents \|\| fields\.nonMemberPriceCents !== existing\.non_member_price_cents/);
});

test('capacity cannot be reduced below the current count of active registrations', () => {
  assert.match(seminarsSource, /fields\.capacity < activeCount/);
  assert.match(seminarsSource, /registration_status='registered'/);
});

test('canceling a seminar cascades to cancel its still-active registrations, with its own audited action, distinct from a member canceling their own registration', () => {
  assert.match(seminarsSource, /admin\.seminar\.registrations_canceled_by_cascade/);
  assert.match(seminarsSource, /existing\.status !== 'canceled' && fields\.status === 'canceled'/);
});

test('seminar creation, edits, and registration/payment/status mutations are all audited', () => {
  for (const action of ['admin.seminar.created', 'admin.seminar.edited']) {
    assert.match(seminarsSource, new RegExp(action.replaceAll('.', '\\.')));
  }
  for (const action of ['member.seminar_registration.registered', 'guest.seminar_registration.registered', 'member.seminar_registration.canceled', 'admin.seminar_registration.payment_marked_paid', 'admin.seminar_registration.status_changed', 'admin.seminar_registration.details_updated']) {
    assert.match(registrationsSource, new RegExp(action.replaceAll('.', '\\.')));
  }
});

test('every admin Server Action requires CSRF evidence before any mutation, directly or through the shared run() helper', () => {
  const runHelper = adminActions.match(/async function run\([\s\S]*?\n\}/)?.[0];
  assert.ok(runHelper); assert.match(runHelper as string, /requireCsrfToken\(/);
  for (const name of ['createSeminarAction', 'updateSeminarAction', 'recordManualSeminarPaymentAction', 'setAdminRegistrationStatusAction', 'updateSeminarRegistrationDetailsAction', 'refundSeminarRegistrationAction']) {
    const fn = adminActions.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(fn, `${name} not found`);
    assert.ok(/requireCsrfToken\(/.test(fn as string) || /\brun\(/.test(fn as string), `${name} must call requireCsrfToken directly or via run()`);
  }
  // The Quick Actions status-shortcut Server Actions this superseded must actually be gone, not just unused.
  assert.doesNotMatch(adminActions, /publishSeminarAction|cancelSeminarAction|revertSeminarToDraftAction|markSeminarRegistrationPaidAction/);
});

test('every member and guest Server Action requires CSRF evidence before any mutation', () => {
  for (const name of ['registerForSeminarAction', 'cancelSeminarRegistrationAction']) {
    const fn = memberActions.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(fn, `${name} not found`);
    assert.match(fn as string, /requireCsrfToken\(/);
  }
  // Deliberately not wrapped in the shared validatedAction helper: that helper's own zod parse would
  // reject a bad field before this action's callback ever ran, with no chance to echo the submitted
  // name/email back to the form -- so this action does its own CSRF + validation instead.
  const fn = guestActions.match(/export async function registerAsGuestForSeminarAction[\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'registerAsGuestForSeminarAction not found');
  assert.match(fn as string, /requireCsrfToken\(/);
});

test('the anonymous guest seminar registration action is gated by Turnstile and a per-email/per-origin rate limit, the same anonymous-write pattern the public contact form uses', () => {
  assert.match(guestActions, /verifyTurnstile\(turnstileToken, origin, 'seminar_guest_registration'\)/);
  assert.match(guestActions, /checkRateLimit\('seminar_guest_registration', email, origin\)/);
  const registrationForm = readFileSync('components/seminars/seminar-registration-form.tsx', 'utf8');
  assert.match(registrationForm, /TurnstileWidget/);
  assert.match(registrationForm, /name="turnstileToken"/);
});

test('the guest registration action echoes the submitted name/email back on every failure path, so a validation or Turnstile/rate-limit error never wipes what the visitor typed', () => {
  assert.match(guestActions, /const echo = \{ ?email:/);
  const failureReturns = guestActions.match(/return \{ \.\.\.echo,/g) ?? [];
  assert.ok(failureReturns.length >= 3, 'every failure branch (validation, turnstile, rate limit, registration error) should echo the submitted values back');
});

test('seminar payments are classified separately from membership billing: the checkout module never imports the membership/payment-ledger schema tables', () => {
  assert.doesNotMatch(checkoutSource, /from '@\/lib\/db\/schema'/);
  assert.match(checkoutSource, /kind: 'seminar_registration'/);
});

test('a guest checkout session is priced against the non-member fee and uses customer_email, never a managed billing-account Customer', () => {
  assert.match(checkoutSource, /customer_email: email/);
  assert.match(checkoutSource, /profile_id is null then s\.non_member_price_cents else s\.member_price_cents/);
});

test('a guest\'s attacker-controlled name is HTML-escaped before interpolation into every transactional email that renders it', () => {
  assert.match(registrationsSource, /escapeHtml\(name\)/);
  assert.match(registrationsSource, /escapeHtml\(seminarTitle\)/);
  const webhookSource = readFileSync('lib/payments/webhook-handlers.ts', 'utf8');
  const refundsSource = readFileSync('lib/payments/refunds.ts', 'utf8');
  assert.match(webhookSource, /escapeHtml\(registration\.guestName \?\? ''\)/g);
  assert.equal(webhookSource.match(/escapeHtml\(registration\.guestName \?\? ''\)/g)?.length, 2, 'both the payment-confirmed and refund-confirmed guest emails must escape the guest name');
  assert.match(refundsSource, /escapeHtml\(row\.first_name \?\? ''\)/);
});

test('recording a manual payment is refused while a registration has an open Stripe checkout session, to prevent a double charge', () => {
  assert.match(registrationsSource, /checkoutStatus === 'open'/);
});

test('reactivating a canceled registration re-runs the seminar open\/deadline\/capacity gate rather than skipping it, and acquires the seminar lock before the registration\'s own lock to match registerForSeminar\'s lock order', () => {
  const fn = registrationsSource.match(/export async function setAdminRegistrationStatus[\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'setAdminRegistrationStatus not found');
  const body = fn as string;
  assert.match(body, /requireSeminarOpenForRegistration\(sql, peek\.seminar_id\)/);
  const seminarLockIndex = body.indexOf('requireSeminarOpenForRegistration(sql, peek.seminar_id)');
  const registrationLockIndex = body.indexOf('for update`');
  assert.ok(seminarLockIndex < registrationLockIndex, 'the seminar lock must be acquired before the registration row is locked "for update"');
});

test('recording a manual payment refreshes a stale, locally-open Stripe checkout status against Stripe itself rather than trusting it forever', () => {
  assert.match(registrationsSource, /checkout\.sessions\.retrieve\(existing\.stripe_checkout_session_id\)/);
});

test('the CSV export route exposes only the documented columns, including guest registrants, and is BOM-prefixed for spreadsheet compatibility', () => {
  assert.match(exportRoute, /toCsv\(rows, \['seminar_title', 'registrant_name', 'registrant_email', 'is_guest', 'registration_status', 'payment_status', 'payment_method_canonical_id', 'expected_amount_cents', 'currency', 'refund_ids', 'refunded_amount_cents', 'registered_at', 'canceled_at', 'paid_at'\]\)/);
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

test('the seminar fieldset asks for "Directors and Application Details", multi-day start/end dates, dual member/non-member prices, and no payment method field', () => {
  assert.match(seminarFieldset, /Directors and Application Details/);
  assert.match(seminarFieldset, /name="startDate"/);
  assert.match(seminarFieldset, /name="endDate"/);
  assert.match(seminarFieldset, /name="memberPrice"/);
  assert.match(seminarFieldset, /name="nonMemberPrice"/);
  assert.doesNotMatch(seminarFieldset, /paymentMethodId|name="paymentMethod"/);
});

test('a locked (disabled) price input still submits its value via a hidden mirror field, so editing a seminar with registrations never fails price validation', () => {
  const memberPriceBlock = seminarFieldset.match(/id="memberPrice"[\s\S]*?<\/div>/)?.[0];
  const nonMemberPriceBlock = seminarFieldset.match(/id="nonMemberPrice"[\s\S]*?<\/div>/)?.[0];
  assert.ok(memberPriceBlock && /type="hidden" value=\{\(seminar\.member_price_cents/.test(memberPriceBlock), 'memberPrice needs a hidden fallback for when the visible input is disabled');
  assert.ok(nonMemberPriceBlock && /type="hidden" value=\{\(seminar\.non_member_price_cents/.test(nonMemberPriceBlock), 'nonMemberPrice needs a hidden fallback for when the visible input is disabled');
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

test('the public seminar catalog shows both the member and non-member price, with each seminar linking to its own detail page for registration', () => {
  const publicPage = readFileSync('app/(marketing)/seminars/page.tsx', 'utf8');
  assert.match(publicPage, /PublicSeminarsCatalog/);
  assert.match(memberPage, /export async function PublicSeminarsCatalog/);
  assert.match(memberPage, /Members: .*Non-members:/);
  assert.match(memberPage, /href=\{`\/seminars\/\$\{seminar\.id\}`\}/);
});

test('every seminar listing card (available, my seminars, public catalog) is a single clickable link to that seminar\'s detail page, not just its title', () => {
  const availableBlock = memberPage.match(/async function AvailableSeminars[\s\S]*?\n\}/)?.[0];
  const myBlock = memberPage.match(/async function MySeminars[\s\S]*?\n\}/)?.[0];
  const publicBlock = memberPage.match(/export async function PublicSeminarsCatalog[\s\S]*?\n\}/)?.[0];
  assert.ok(availableBlock && /<Link className="card-midnight block cursor-pointer p-6" href=\{`\/seminars\/\$\{seminar\.id\}`\}>/.test(availableBlock));
  assert.ok(myBlock && /<Link className="absolute inset-0" href=\{`\/seminars\/\$\{seminar\.id\}`\}>/.test(myBlock), 'My Seminars keeps its Cancel action independently clickable via a stretched overlay link, not a wrapping one');
  assert.ok(publicBlock && /<Link className="card-midnight block cursor-pointer p-6" href=\{`\/seminars\/\$\{seminar\.id\}`\}>/.test(publicBlock));
});

test('the seminar detail page presents full details and offers a member registration form, a join-or-guest choice, or the visitor\'s existing registration status', () => {
  const detailPage = readFileSync('app/(marketing)/seminars/[id]/page.tsx', 'utf8');
  assert.match(detailPage, /getSeminarForRegistrant/);
  assert.match(detailPage, /Directors and Application Details/);
  assert.match(detailPage, /SeminarRegistrationForm/);
  assert.match(detailPage, /SeminarRegistrationPanel/);
  assert.match(detailPage, /isEntitled\(member\.entitlement/);
});

test('the seminar registration panel offers "Create an account" and "Register as a guest" buttons, revealing the shared registration form for the guest path', () => {
  const panel = readFileSync('components/seminars/seminar-registration-panel.tsx', 'utf8');
  assert.match(panel, /Create an account/);
  assert.match(panel, /Register as a guest/);
  assert.match(panel, /href="\/sign-up"/);
  assert.match(panel, /SeminarRegistrationForm/);
});

test('the shared seminar registration form pre-fills and locks the name\/email fields for a member, and shows them as editable inputs for a guest', () => {
  const form = readFileSync('components/seminars/seminar-registration-form.tsx', 'utf8');
  assert.match(form, /registerForSeminarAction/);
  assert.match(form, /registerAsGuestForSeminarAction/);
  assert.match(form, /readOnly=\{isMember\}/);
  assert.match(form, /required=\{!isMember\}/);
});

test('the admin seminar edit page has no Quick Actions box and offers a "View registrations" and an icon-only "Download registrations" action instead', () => {
  const adminEditPage = readFileSync('app/(dashboard)/admin/seminars/[id]/page.tsx', 'utf8');
  assert.doesNotMatch(adminEditPage, /Quick [Aa]ctions/);
  assert.doesNotMatch(adminEditPage, /publishSeminarAction|cancelSeminarAction|revertSeminarToDraftAction|markSeminarRegistrationPaidAction/);
  assert.doesNotMatch(adminEditPage, /id="registrations"/);
  assert.match(adminEditPage, /seminars\/registrations\?seminarId=/);
  assert.match(adminEditPage, /title="Download this seminar's registrations"/);
});

test('the admin Registrations page is a cross-seminar roster with search, seminar/payment-status filters, sort, and a download-all-filtered-results action', () => {
  const registrationsPage = readFileSync('app/(dashboard)/admin/seminars/registrations/page.tsx', 'utf8');
  const registrationsTable = readFileSync('app/(dashboard)/admin/seminars/registrations/registrations-table.tsx', 'utf8');
  assert.match(registrationsPage, /listAdminAllSeminarRegistrations/);
  assert.match(registrationsPage, /listPublishedSeminarsForRegistrationFilter/);
  assert.match(registrationsTable, /DataTableSortList/);
  assert.match(registrationsTable, /seminar-all-registrations/);
  const navigation = readFileSync('components/admin-navigation.tsx', 'utf8');
  assert.match(navigation, /\/admin\/seminars\/registrations/);
});

test('the admin seminar list page supports search and status filtering', () => {
  const adminListPage = readFileSync('app/(dashboard)/admin/seminars/page.tsx', 'utf8');
  const sharedTable = readFileSync('components/admin/resource-data-table.tsx', 'utf8');
  assert.match(adminListPage, /ResourceListPage/);
  assert.match(sharedTable, /Search seminar title or location/);
  assert.match(sharedTable, /variant: 'multiSelect'/);
});

test('the admin seminar table provides Dice UI date, sorting, pagination, and visibility controls', () => {
  const page = readFileSync('app/(dashboard)/admin/seminars/page.tsx', 'utf8');
  const table = readFileSync('components/admin/resource-data-table.tsx', 'utf8');
  assert.match(page, /ResourceListPage/);
  for (const value of ['DataTableToolbar', 'DataTableSortList', 'pageSizeOptions', 'DateRangeFilter', 'table.getState().columnVisibility']) assert.match(table, new RegExp(value.replaceAll('(', '\\(').replaceAll(')', '\\)')));
  assert.doesNotMatch(table, /DataTableAdvancedToolbar|DataTableFilterList/);
  assert.match(seminarsSource, /date: 's\.start_date'/);
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
