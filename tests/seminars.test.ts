import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { computeSeminarAvailability, initialPaymentStatusForMethod, registrationDisplayLabel } from '../lib/seminars/status.ts';

const seminarsSource = readFileSync('lib/seminars/seminars.ts', 'utf8');
const registrationsSource = readFileSync('lib/seminars/registrations.ts', 'utf8');
const checkoutSource = readFileSync('lib/seminars/checkout.ts', 'utf8');
const adminActions = readFileSync('app/(dashboard)/admin/seminars/actions.ts', 'utf8');
const memberActions = readFileSync('app/(dashboard)/dashboard/seminars/actions.ts', 'utf8');
const guestActions = readFileSync('app/(marketing)/seminars/actions.ts', 'utf8');
const originalMigration = readFileSync('lib/db/migrations/0041_seminars.sql', 'utf8');
const paymentMethodMigration = readFileSync('lib/db/migrations/0055_seminar_registration_payment_method.sql', 'utf8');
const multiDayMigration = readFileSync('lib/db/migrations/0056_seminars_multiday_dual_price_guest.sql', 'utf8');
const dateOnlyMigration = readFileSync('lib/db/migrations/0061_seminar_date_only_rich_information.sql', 'utf8');
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
  assert.match(dateOnlyMigration, /CHECK \("end_date" >= "start_date"\)/);
  // Legacy time/timezone columns remain nullable during the additive staging rollout so main and staging can safely share the database.
  assert.match(dateOnlyMigration, /ALTER COLUMN "start_time" DROP NOT NULL/);
  assert.match(dateOnlyMigration, /ALTER COLUMN "end_time" DROP NOT NULL/);
  assert.match(dateOnlyMigration, /ALTER COLUMN "timezone" DROP NOT NULL/);
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
  assert.doesNotMatch(seminarsSource, /paymentMethodId/);
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

test('a guest can register without an account using structured contact details and a normalized email', () => {
  assert.match(registrationsSource, /export async function registerAsGuestForSeminar/);
  const guestValidationSource = readFileSync('lib/seminars/guest-registration-validation.ts', 'utf8');
  assert.match(registrationsSource, /guestEmailSchema/);
  assert.match(guestValidationSource, /guestEmailSchema = z\.string\(\)\.trim\(\)\.email\(/);
  assert.match(registrationsSource, /guest_first_name/);
  assert.match(registrationsSource, /guest_last_name/);
  assert.match(registrationsSource, /guest_phone/);
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
  const sharedHelper = memberActions.match(/async function runOwnProfileRegistration\([\s\S]*?\n\}/)?.[0];
  assert.ok(sharedHelper); assert.match(sharedHelper as string, /requireCsrfToken\(/);
  for (const name of ['registerForSeminarAction', 'registerAtNonMemberPriceAction', 'cancelSeminarRegistrationAction']) {
    const fn = memberActions.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(fn, `${name} not found`);
    assert.ok(/requireCsrfToken\(/.test(fn as string) || /\brunOwnProfileRegistration\(/.test(fn as string), `${name} must call requireCsrfToken directly or via runOwnProfileRegistration()`);
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

test('anonymous Checkout uses a schema-safe origin-only rate-limit purpose', () => {
  assert.match(guestActions, /checkOriginRateLimit\('seminar_guest_checkout', origin\)/);
  assert.doesNotMatch(guestActions, /seminar_guest_registration_checkout/);
});

test('anonymous online registration is Stripe-first: Checkout collects contact details and the paid webhook creates the guest registration', () => {
  assert.match(checkoutSource, /export async function createGuestSeminarCheckoutSession/);
  assert.match(checkoutSource, /kind: 'seminar_guest_registration'/);
  assert.match(checkoutSource, /phone_number_collection: \{ enabled: true \}/);
  assert.match(checkoutSource, /key: 'first_name'/);
  assert.match(checkoutSource, /key: 'last_name'/);
  assert.match(checkoutSource, /maximum_length: 99/g);
  const webhookSource = readFileSync('lib/payments/webhook-handlers.ts', 'utf8');
  assert.match(webhookSource, /handleGuestSeminarCheckoutSessionCompleted/);
  assert.match(webhookSource, /session\.customer_details\?\.email/);
  assert.match(webhookSource, /session\.customer_details\?\.phone/);
  assert.match(webhookSource, /guestFirstName: firstName/);
  assert.match(guestActions, /paymentMethod === 'online_stripe'/);
});

test('a guest\'s attacker-controlled name is HTML-escaped before interpolation into every transactional email that renders it', () => {
  assert.match(registrationsSource, /escapeHtml\(firstName\)/);
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

test('the seminar fieldset uses date-only scheduling and the five structured rich-text fields', () => {
  for (const label of ['Course Directors', 'Participant Profile', 'Course Venue Information', 'Application', 'Accommodation Information']) assert.match(seminarFieldset, new RegExp(label));
  assert.doesNotMatch(seminarFieldset, /name="startTime"|name="endTime"|name="timezone"/);
  assert.match(seminarFieldset, /name="startDate"/);
  assert.match(seminarFieldset, /name="endDate"/);
  assert.match(seminarFieldset, /'memberPrice', 'Member price/);
  assert.match(seminarFieldset, /'nonMemberPrice', 'Non-member price/);
  assert.doesNotMatch(seminarFieldset, /paymentMethodId|name="paymentMethod"/);
});

test('a seminar can be flagged as FEI-affiliated: an admin toggle, persisted through create and update, and shown on the public listing cards and detail page', () => {
  assert.match(seminarFieldset, /name="isFei"/);
  assert.match(seminarFieldset, /type="checkbox"/);
  assert.match(seminarsSource, /isFei: input\.isFei === 'on' \|\| input\.isFei === true/);
  assert.match(seminarsSource, /status,is_fei,levels,created_by_user_id/);
  assert.match(seminarsSource, /is_fei=\$\{fields\.isFei\}/);
  assert.match(memberPage, /import \{ FeiBadge \} from '@\/components\/seminars\/fei-badge'/);
  assert.match(memberPage, /seminar\.is_fei \? <div[^>]*><FeiBadge/);
  const detailPage = readFileSync('app/(marketing)/seminars/[id]/page.tsx', 'utf8');
  assert.match(detailPage, /import \{ FeiBadge \} from '@\/components\/seminars\/fei-badge'/);
  assert.match(detailPage, /seminar\.is_fei \? <div[\s\S]*?<FeiBadge/);
});

test('a seminar can be assigned one or more officiating levels via a multi-checkbox admin control, and picking All Levels always displays as the literal "All levels"', () => {
  assert.match(seminarFieldset, /name="levels" type="checkbox" value=\{value\}/);
  assert.match(seminarFieldset, /\{ label: 'Level 1', value: 'level_1' \}/);
  assert.match(seminarFieldset, /\{ label: 'Level 2', value: 'level_2' \}/);
  assert.match(seminarFieldset, /\{ label: 'Level 3', value: 'level_3' \}/);
  assert.match(seminarFieldset, /\{ label: 'All Levels', value: 'all_levels' \}/);
  assert.match(seminarsSource, /SEMINAR_LEVELS = \['level_1', 'level_2', 'level_3', 'all_levels'\]/);
  assert.match(seminarsSource, /selected\.includes\('all_levels'\) \? \['all_levels'\] : \[\.\.\.new Set\(selected\)\]/);
  const formatSource = readFileSync('lib/seminars/format.ts', 'utf8');
  assert.match(formatSource, /if \(levels\.includes\('all_levels'\)\) return 'All levels'/);
  const detailPage = readFileSync('app/(marketing)/seminars/[id]/page.tsx', 'utf8');
  assert.match(detailPage, /formatLevels/);
  // The levels row sits directly above the FEI badge in the icon-block list.
  const levelsIndex = detailPage.indexOf('InfoRow icon={Layers}');
  const feiIndex = detailPage.indexOf('seminar.is_fei ? <div');
  assert.ok(levelsIndex > -1 && feiIndex > -1 && levelsIndex < feiIndex, 'the Levels row must appear directly above the FEI badge');
});

test('a locked price input still submits its value through a hidden mirror', () => {
  assert.match(seminarFieldset, /lockPrices && cents !== undefined/);
  assert.match(seminarFieldset, /<input name=\{name\} type="hidden"/);
});

test('the member Seminars page renders registration and payment status labels', () => {
  assert.match(memberPage, /registrationDisplayLabel/);
  const statusSource = readFileSync('lib/seminars/status.ts', 'utf8');
  for (const label of ['Canceled', 'Registration closed', 'Full', 'Open', 'Past', 'Bank transfer pending', 'Cash pending', 'Paid', 'Unpaid']) {
    assert.ok(statusSource.includes(label), `label "${label}" is not defined in lib/seminars/status.ts`);
  }
});

test('the member Seminars page separates current registrations from available seminars, with no redundant sub-heading repeating what the tab already says', () => {
  for (const label of ['Available seminars', 'My seminar registrations', 'Past seminars']) {
    assert.match(memberPage, new RegExp(label));
  }
  assert.match(memberPage, /const registered/);
  assert.match(memberPage, /const upcoming/);
  // "My seminar registrations" already says what this list is -- a second, identical sub-heading
  // directly under it is pure noise, and it previously stayed visible on the Past tab too, since it
  // never depended on which tab was selected.
  assert.doesNotMatch(memberPage, /Your upcoming and current registrations/);
});

test('Available Seminars is one flat list (open, full, or closed together, not split into a second confusingly-named section), with a status tag replacing the old separate heading', () => {
  const availableBlock = memberPage.match(/async function AvailableSeminars[\s\S]*?\n\}/)?.[0];
  assert.ok(availableBlock, 'AvailableSeminars not found');
  assert.doesNotMatch(memberPage, /Other upcoming seminars/);
  assert.match(availableBlock as string, /AvailabilityTag/);
});

test('both the member catalog and the signed-out public catalog show an already-ended, published seminar under a white "Past seminars" heading', () => {
  assert.match(memberPage, /listPastPublishedSeminars/);
  const availableBlock = memberPage.match(/async function AvailableSeminars[\s\S]*?\n\}/)?.[0];
  const publicBlock = memberPage.match(/export async function PublicSeminarsCatalog[\s\S]*?\n\}/)?.[0];
  for (const block of [availableBlock, publicBlock]) {
    assert.ok(block, 'catalog block not found');
    assert.match(block as string, /<h3 className="text-lg font-semibold text-foreground">Past seminars<\/h3>/);
  }
  assert.match(registrationsSource, /export async function listPastPublishedSeminars/);
  assert.match(registrationsSource, /s\.status='published' and s\.end_date < current_date/);
});

test('the public seminar catalog shows both the member and non-member price, with each seminar linking to its own detail page for registration', () => {
  const publicPage = readFileSync('app/(marketing)/seminars/page.tsx', 'utf8');
  assert.match(publicPage, /PublicSeminarsCatalog/);
  assert.match(memberPage, /export async function PublicSeminarsCatalog/);
  assert.match(memberPage, /Members: .*Non-members:/);
  assert.match(memberPage, /href=\{`\/seminars\/\$\{seminar\.id\}`\}/);
});

test('all seminar listing surfaces reuse a compact, uniformly constrained card with independent navigation and FEI links', () => {
  const cardStart = memberPage.indexOf('export function SeminarListingCard');
  const cardEnd = memberPage.indexOf('/** \"Available seminars\"', cardStart);
  const cardBlock = memberPage.slice(cardStart, cardEnd);
  assert.ok(cardStart > -1 && cardEnd > cardStart);
  assert.match(cardBlock as string, /sm:grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(cardBlock as string, /<Link aria-label=\{`View \${seminar\.title}`\} className="absolute inset-0 z-10"/);
  assert.match(cardBlock as string, /relative z-20[^"]*sm:ml-4/);
  const navigationEnd = cardBlock.indexOf('/>', cardBlock.indexOf('<Link'));
  assert.ok(navigationEnd > -1 && navigationEnd < cardBlock.indexOf('<FeiBadge'), 'the navigation link must self-close before the independent FEI anchor');
  assert.match(memberPage, /w-full max-w-3xl divide-y/);
  const homePage = readFileSync('app/(marketing)/page.tsx', 'utf8');
  assert.match(homePage, /SeminarListingCard/);
  assert.match(homePage, /w-full max-w-3xl divide-y/);
});

test('pricing follows title and date-only metadata inside the shared seminar information column', () => {
  const cardIndex = memberPage.indexOf('export function SeminarListingCard');
  const metadataIndex = memberPage.indexOf('formatSchedule(seminar)', cardIndex);
  const childrenIndex = memberPage.indexOf('{children ?', cardIndex);
  const feiIndex = memberPage.indexOf('seminar.is_fei ?', cardIndex);
  assert.ok(cardIndex > -1 && metadataIndex > cardIndex && childrenIndex > metadataIndex && feiIndex > childrenIndex);
  assert.doesNotMatch(memberPage, /justify-between/);
});

test('a signed-in profile without current entitlement (a lapsed membership) sees both prices on Available Seminars, since the detail page will route it to guest/non-member pricing', () => {
  assert.match(memberPage, /showBothPrices/);
  const availableBlock = memberPage.match(/async function AvailableSeminars[\s\S]*?\n\}/)?.[0];
  assert.ok(availableBlock && /showBothPrices \? `Members: .*Non-members:/.test(availableBlock));
  const dispatchBlock = memberPage.match(/export async function MemberRegistrations[\s\S]*?\n\}/)?.[0];
  assert.ok(dispatchBlock && /isEntitled\(member\.entitlement/.test(dispatchBlock) && /showBothPrices=\{!entitled\}/.test(dispatchBlock));
});

test('the seminar detail page presents full details and offers the Register CTA, or the visitor\'s existing registration status', () => {
  const detailPage = readFileSync('app/(marketing)/seminars/[id]/page.tsx', 'utf8');
  assert.match(detailPage, /getSeminarForRegistrant/);
  for (const label of ['Course Directors', 'Participant Profile', 'Course Venue Information', 'Application', 'Accommodation Information']) assert.match(detailPage, new RegExp(label));
  assert.match(detailPage, /SeminarRegisterCta/);
  assert.match(detailPage, /isEntitled\(member\.entitlement/);
  // The whole page uses the site's full fixed-width container, left-aligned like every other page.
  assert.match(detailPage, /max-w-7xl/);
  assert.doesNotMatch(detailPage, /max-w-4xl/);
  // The shadcn Card component bakes in `py-6` unconditionally (components/ui/card.tsx), regardless
  // of CardContent's own padding -- the icon-block info Card must cancel it with `py-0`, or the
  // Card's own vertical padding stacks on top of each InfoRow's `p-5`, leaving visibly excess empty
  // space above the first row and below the FEI badge.
  const infoCardBlock = detailPage.match(/<Card[^>]*>\s*<CardContent className="space-y-0 p-0">/)?.[0];
  assert.ok(infoCardBlock && /<Card className="py-0">/.test(infoCardBlock), 'the icon-block info Card must cancel the base Card component\'s py-6 with py-0');
});

test('a signed-in visitor without member pricing registers under their own profile at the non-member price, never the anonymous guest identity, once they click Register', () => {
  const detailPage = readFileSync('app/(marketing)/seminars/[id]/page.tsx', 'utf8');
  assert.match(detailPage, /import \{ getUser \} from '@\/lib\/db\/queries'/);
  assert.match(detailPage, /const isSignedIn = Boolean\(user\)/);
  // A signed-in visitor with their own profile (a lapsed membership) gets ownProfileDetails, tied to
  // their real profileId at the non-member price -- never the guest identity.
  assert.match(detailPage, /ownProfileDetails=\{!isEntitledMember && member \? \{ email: member\.email, name:/);
  assert.match(detailPage, /memberDetails=\{isEntitledMember && member \? \{ email: member\.email, name:/);
  const ctaSource = readFileSync('components/seminars/seminar-register-cta.tsx', 'utf8');
  // A signed-in visitor (with or without a profile) opens the shared payment dialog directly --
  // the join-or-guest dialog is reachable only when isSignedIn is false too.
  assert.match(ctaSource, /const hasProfile = Boolean\(memberDetails\) \|\| Boolean\(ownProfileDetails\)/);
  assert.match(ctaSource, /const knownVisitor = hasProfile \|\| isSignedIn/);
  assert.match(ctaSource, /knownVisitor \? setPaymentDialogOpen\(true\) : setJoinDialogOpen\(true\)/);
  assert.match(ctaSource, /Choose a payment method/);
});

test('authenticated seminar registration never renders the contact form and always uses the signed-in profile for every payment method', () => {
  assert.match(registrationsSource, /export async function registerForSeminarAtNonMemberPrice/);
  assert.match(registrationsSource, /async function requireOwnProfileIdRegardlessOfEntitlement/);
  assert.match(memberActions, /export async function registerForSeminarAction/);
  assert.match(memberActions, /export async function registerAtNonMemberPriceAction/);
  const cta = readFileSync('components/seminars/seminar-register-cta.tsx', 'utf8');
  assert.match(cta, /if \(hasProfile\)/);
  assert.match(cta, /action=\{authenticatedAction\}/);
  assert.match(cta, /name="paymentMethod"/);
  assert.match(cta, /!hasProfile \? <TurnstileWidget/);
  assert.doesNotMatch(cta, /<SeminarRegistrationForm memberDetails=/);
  const form = readFileSync('components/seminars/seminar-registration-form.tsx', 'utf8');
  assert.doesNotMatch(form, /registerForSeminarAction|registerAtNonMemberPriceAction|memberDetails|ownProfileDetails|readOnly/);
  assert.match(form, /anonymous-only/);
});

test('the Register CTA is a single full-width button; a signed-out visitor sees a branded join-or-guest dialog instead of a separate boxed panel', () => {
  const cta = readFileSync('components/seminars/seminar-register-cta.tsx', 'utf8');
  assert.match(cta, /className="w-full text-xs uppercase tracking-\[0\.2em\]"/);
  assert.match(cta, />\s*Register\s*</);
  assert.match(cta, /Join to get member pricing of \{memberPriceLabel\}/);
  assert.match(cta, /Register as a guest/);
  assert.match(cta, /href="\/sign-up"/);
  assert.match(cta, /import \{ Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle \} from '@\/components\/ui\/dialog'/);
  assert.match(cta, /SeminarRegistrationForm/);
  assert.match(cta, /startGuestSeminarStripeCheckoutAction/);
  assert.match(cta, /methodId === 'online_stripe'/);
  assert.match(cta, /useActionState<GuestStripeCheckoutState, FormData>/);
  assert.match(cta, /disabled=\{!guestTurnstileToken \|\| guestCheckoutPending\}/);
});

test('the IDOC contact registration form is only for anonymous bank-transfer/cash registration and is visually identified as registration', () => {
  const form = readFileSync('components/seminars/seminar-registration-form.tsx', 'utf8');
  assert.match(form, /registerAsGuestForSeminarAction/);
  assert.doesNotMatch(form, /registerForSeminarAction|registerAtNonMemberPriceAction/);
  assert.match(form, /rounded-xl border bg-card/);
  assert.match(form, />Register<\/h2>/);
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


test('Stripe webhook processing failures are observable and retryable', () => {
  const routeSource = readFileSync('app/api/stripe/webhook/route.ts', 'utf8');
  const eventSource = readFileSync('lib/observability/security-events.ts', 'utf8');
  assert.match(routeSource, /logError\('stripe_webhook_processing_failed'/);
  assert.match(routeSource, /throw error/);
  assert.match(eventSource, /stripe_webhook_processing_failed:[\s\S]*retentionClass: 'operational'/);
  assert.doesNotMatch(eventSource, /stripe_webhook_processing_failed:[^\n]*sentry: true/);
});
