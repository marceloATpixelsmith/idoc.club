import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { APPROVAL_STATUS_LABELS, APPROVAL_STATUSES, computeSeminarAvailability, FEI_APPROVAL_STATUSES, initialApprovalStatus, initialPaymentStatusForMethod, registrationDisplayLabel } from '../lib/seminars/status.ts';

const seminarsSource = readFileSync('lib/seminars/seminars.ts', 'utf8');
const registrationsSource = readFileSync('lib/seminars/registrations.ts', 'utf8');
const checkoutSource = readFileSync('lib/seminars/checkout.ts', 'utf8');
const adminActions = readFileSync('app/(dashboard)/admin/seminars/actions.ts', 'utf8');
const memberActions = readFileSync('app/(dashboard)/dashboard/seminars/actions.ts', 'utf8');
const originalMigration = readFileSync('lib/db/migrations/0041_seminars.sql', 'utf8');
const paymentMethodMigration = readFileSync('lib/db/migrations/0055_seminar_registration_payment_method.sql', 'utf8');
const multiDayMigration = readFileSync('lib/db/migrations/0056_seminars_multiday_dual_price_guest.sql', 'utf8');
const dateOnlyMigration = readFileSync('lib/db/migrations/0061_seminar_date_only_rich_information.sql', 'utf8');
const exportRoute = readFileSync('app/api/admin/export/seminar-registrations/route.ts', 'utf8');
const seminarFieldset = readFileSync('components/seminars/seminar-fieldset.tsx', 'utf8');
const memberPage = readFileSync('components/seminars/member-registrations.tsx', 'utf8');
const approvalMigration = readFileSync('lib/db/migrations/0072_seminar_approval_directory_optin_support_suggestion.sql', 'utf8');

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

test('every registration belongs to a real member profile: the guest identity columns, constraint and index are dropped and profile_id is NOT NULL', () => {
  const cleanup = readFileSync('lib/db/migrations/0073_remove_guest_and_non_member_legacy.sql', 'utf8');
  assert.match(cleanup, /DROP INDEX IF EXISTS "idoc"\."seminar_registrations_seminar_guest_email_unique"/);
  assert.match(cleanup, /DROP CONSTRAINT IF EXISTS "seminar_registrations_registrant_identity_check"/);
  assert.match(cleanup, /DROP COLUMN IF EXISTS "guest_email"/);
  assert.match(cleanup, /ALTER COLUMN "profile_id" SET NOT NULL/);
  assert.match(cleanup, /DROP COLUMN IF EXISTS "non_member_price_cents"/);
  assert.match(cleanup, /DROP COLUMN IF EXISTS "organizing_national_federation"/);
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
  for (const action of ['member.seminar_registration.registered', 'member.seminar_registration.canceled', 'admin.seminar_registration.created', 'admin.seminar_registration.payment_marked_paid', 'admin.seminar_registration.status_changed', 'admin.seminar_registration.approval_status_changed', 'admin.seminar_registration.details_updated']) {
    assert.match(registrationsSource, new RegExp(action.replaceAll('.', '\\.')));
  }
});

test('every admin Server Action requires CSRF evidence before any mutation, directly or through the shared run() helper', () => {
  const runHelper = adminActions.match(/async function run\([\s\S]*?\n\}/)?.[0];
  assert.ok(runHelper); assert.match(runHelper as string, /requireCsrfToken\(/);
  for (const name of ['createSeminarAction', 'updateSeminarAction', 'recordManualSeminarPaymentAction', 'setAdminRegistrationStatusAction', 'setAdminRegistrationApprovalStatusAction', 'createAdminSeminarRegistrationAction', 'updateSeminarRegistrationDetailsAction', 'refundSeminarRegistrationAction']) {
    const fn = adminActions.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(fn, `${name} not found`);
    assert.ok(/requireCsrfToken\(/.test(fn as string) || /\brun\(/.test(fn as string), `${name} must call requireCsrfToken directly or via run()`);
  }
  // The Quick Actions status-shortcut Server Actions this superseded must actually be gone, not just unused.
  assert.doesNotMatch(adminActions, /publishSeminarAction|cancelSeminarAction|revertSeminarToDraftAction|markSeminarRegistrationPaidAction/);
});

test('seminar payments are classified separately from membership billing: the checkout module never imports the membership/payment-ledger schema tables', () => {
  assert.doesNotMatch(checkoutSource, /from '@\/lib\/db\/schema'/);
  assert.match(checkoutSource, /seminar_registration_staging/);
  assert.match(checkoutSource, /seminar_registration/);
});

test('a member\'s name and the seminar title are HTML-escaped before interpolation into the registration email', () => {
  assert.match(registrationsSource, /escapeHtml\(firstName\)/);
  assert.match(registrationsSource, /escapeHtml\(seminar\.title\)/);
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

test('My Seminars never renders bank-transfer instructions in the registration listing', () => {
  assert.doesNotMatch(memberPage, /sanitizeBankInstructions/);
  assert.doesNotMatch(memberPage, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(memberPage, /Payment Method:/);
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

test('the seminar fieldset uses date-only scheduling and re-sanitizes all five rich-text fields before loading the editor', () => {
  for (const label of ['Course Directors', 'Participant Profile', 'Course Venue Information', 'Application', 'Accommodation Information']) assert.match(seminarFieldset, new RegExp(label));
  for (const field of ['course_directors', 'participant_profile', 'course_venue_information', 'application', 'accommodation_information']) {
    assert.ok(seminarFieldset.includes(`initialHtml={sanitizeArticleContent(seminar?.${field} ?? '')}`), `${field} must be sanitized before loading the editor`);
  }
  assert.doesNotMatch(seminarFieldset, /name="startTime"|name="endTime"|name="timezone"/);
  assert.match(seminarFieldset, /name="startDate"/);
  assert.match(seminarFieldset, /name="endDate"/);
  assert.match(seminarFieldset, /name="price"/);
  assert.doesNotMatch(seminarFieldset, /nonMemberPrice|Non-member|memberPrice|organizingNationalFederation/);
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
  assert.match(seminarFieldset, /lockPrices && seminar/);
  assert.match(seminarFieldset, /<input name="price" type="hidden"/);
});

test('the member Seminars page renders registration and payment status labels', () => {
  assert.match(memberPage, /APPROVAL_STATUS_LABELS/);
  assert.match(memberPage, /PAYMENT_STATUS_LABELS/);
  assert.match(memberPage, /Status: <strong>\{registrationStatus === 'canceled'[^}]*APPROVAL_STATUS_LABELS\[approvalStatus\]\} \/ \$\{PAYMENT_STATUS_LABELS\[paymentStatus\]\}/);
  const statusSource = readFileSync('lib/seminars/status.ts', 'utf8');
  for (const label of ['Canceled', 'Registration closed', 'Full', 'Open', 'Past', 'Bank transfer pending', 'Cash pending', 'Paid', 'Unpaid']) {
    assert.ok(statusSource.includes(label), `label "${label}" is not defined in lib/seminars/status.ts`);
  }
});

test('the member Seminars page separates current registrations from available seminars, with no redundant sub-heading repeating what the tab already says', () => {
  for (const label of ['Available seminars/courses', 'My seminar/course registrations', 'Past seminars/courses']) {
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

test('both the member catalog and the signed-out public catalog show an already-ended, published seminar under a "Past seminars" section-label heading', () => {
  assert.match(memberPage, /listPastPublishedSeminars/);
  const availableBlock = memberPage.match(/async function AvailableSeminars[\s\S]*?\n\}/)?.[0];
  const publicBlock = memberPage.match(/export async function PublicSeminarsCatalog[\s\S]*?\n\}/)?.[0];
  for (const block of [availableBlock, publicBlock]) {
    assert.ok(block, 'catalog block not found');
    assert.match(block as string, /<h3 className="section-label">Past seminars\/courses<\/h3>/);
  }
  assert.match(registrationsSource, /export async function listPastPublishedSeminars/);
  assert.match(registrationsSource, /s\.status='published' and s\.end_date < current_date/);
});

test('all seminar listing surfaces reuse a compact, uniformly constrained card with independent navigation and FEI links', () => {
  const cardStart = memberPage.indexOf('export function SeminarListingCard');
  const cardEnd = memberPage.indexOf('/** \"Available seminars\"', cardStart);
  const cardBlock = memberPage.slice(cardStart, cardEnd);
  assert.ok(cardStart > -1 && cardEnd > cardStart);
  assert.match(cardBlock as string, /sm:grid-cols-\[minmax\(0,max-content\)_auto\]/);
  assert.match(cardBlock as string, /<Link aria-label=\{`View \${seminar\.title}`\} className="absolute inset-0 z-10"/);
  assert.match(cardBlock as string, /relative z-20[^"]*w-fit shrink-0/);
  const navigationEnd = cardBlock.indexOf('/>', cardBlock.indexOf('<Link'));
  assert.ok(navigationEnd > -1 && navigationEnd < cardBlock.indexOf('<FeiBadge'), 'the navigation link must self-close before the independent FEI anchor');
  assert.match(memberPage, /w-fit max-w-full divide-y/);
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

test('the admin Seminar table owns registration/download actions while edit/create forms open as table-backed drawers', () => {
  const adminListPage = readFileSync('app/(dashboard)/admin/seminars/page.tsx', 'utf8');
  const seminarDrawer = readFileSync('app/(dashboard)/admin/seminars/seminar-drawer.tsx', 'utf8');
  const resourceTable = readFileSync('components/admin/resource-data-table.tsx', 'utf8');
  assert.match(adminListPage, /AdminSeminarDrawer/);
  assert.match(adminListPage, /seminarId/);
  assert.match(adminListPage, /new/);
  assert.match(seminarDrawer, /AdminFormDrawer/);
  assert.doesNotMatch(seminarDrawer, /Quick [Aa]ctions/);
  assert.doesNotMatch(seminarDrawer, /publishSeminarAction|cancelSeminarAction|revertSeminarToDraftAction|markSeminarRegistrationPaidAction/);
  assert.match(resourceTable, /\/admin\/seminars\?seminarId=/);
  assert.match(resourceTable, /seminars\/registrations\?seminarId=/);
  assert.match(resourceTable, /title="Download this seminar's registrations"/);
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


test('seminar registration delivery cannot fall back to the legacy generic email', async () => {
  const source = readFileSync('lib/notifications/renewal-notices.ts', 'utf8');
  assert.doesNotMatch(source, /Your seminar registration was recorded/);
  assert.match(source, /seminar_registration_confirmation_missing_seminar_id/);
  assert.match(source, /seminar_registration_confirmation_missing_payment_method/);
  assert.match(source, /seminarRegistrationConfirmationBodyHtml/);
});


test('every seminar registration path uses the one detailed confirmation contract', async () => {
  const registrations = readFileSync('lib/seminars/registrations.ts', 'utf8');
  const webhooks = readFileSync('lib/payments/webhook-handlers.ts', 'utf8');
  const notices = readFileSync('lib/notifications/renewal-notices.ts', 'utf8');

  assert.match(registrations, /paymentMethod !== 'online_stripe'/);
  assert.match(registrations, /seminar\.registration_created/);
    assert.match(webhooks, /seminar\.registration_created:\$\{registrationId\}:stripe-paid/);
  assert.doesNotMatch(webhooks, /best-effort; payment and registration are already durable/);
  assert.doesNotMatch(notices, /Your seminar registration was recorded/);
  assert.match(notices, /seminarRegistrationConfirmationBodyHtml/);
});


test('seminar registration confirmation has no generic fallback path anywhere in delivery code', () => {
  const notices = readFileSync('lib/notifications/renewal-notices.ts', 'utf8');
  const registrations = readFileSync('lib/seminars/registrations.ts', 'utf8');
  const webhooks = readFileSync('lib/payments/webhook-handlers.ts', 'utf8');
  const combined = [notices, registrations, webhooks].join('\n');

  assert.doesNotMatch(combined, /Seminar registration received/i);
  assert.doesNotMatch(combined, /Your seminar registration was recorded/i);
  assert.doesNotMatch(combined, /payment is confirmed separately/i);
  assert.match(notices, /registrationId/);
  assert.match(notices, /seminarRegistrations\.seminarId/);
  assert.match(notices, /seminarRegistrationConfirmationBodyHtml/);
});


test('all Brevo transactional email uses Accounts as the sender name', () => {
  const source = readFileSync('lib/notifications/brevo-transactional.ts', 'utf8');
  assert.match(source, /sender: \{ email: fromEmail, name: 'Accounts' \}/);
});

test('seminar confirmation preserves the enqueued registration-cycle snapshot', () => {
  const source = readFileSync('lib/notifications/renewal-notices.ts', 'utf8');
  assert.match(source, /amountCents: payload\.amountCents/);
  assert.match(source, /firstName: payload\.firstName/);
  assert.match(source, /paymentConfirmed: payload\.paymentConfirmed/);
  assert.match(source, /paymentMethod: payload\.paymentMethod/);
  assert.doesNotMatch(source, /r\.expected_amount_cents/);
  assert.doesNotMatch(source, /r\.payment_method_canonical_id/);
  assert.match(source, /seminarRegistrations\.seminarId/);
  assert.match(source, /seminarRegistrationConfirmationBodyHtml/);
});


test('staging seminar confirmations use a durable staging-owned queue and checkout-origin ownership', () => {
  const registrations = readFileSync('lib/seminars/registrations.ts', 'utf8');
  const checkout = readFileSync('lib/seminars/checkout.ts', 'utf8');
  const memberActions = readFileSync('app/(dashboard)/dashboard/seminars/actions.ts', 'utf8');
  const webhooks = readFileSync('lib/payments/webhook-handlers.ts', 'utf8');
  const stripeRoute = readFileSync('app/api/stripe/webhook/route.ts', 'utf8');
  const notices = readFileSync('lib/notifications/renewal-notices.ts', 'utf8');

  assert.match(registrations, /hostname === 'staging\.idoc\.club'/);
  assert.match(registrations, /confirmationKind = directDelivery \? 'seminar\.staging_registration_created' : 'seminar\.registration_created'/);
  assert.match(memberActions, /processStagingSeminarConfirmationBatch/);
  assert.match(checkout, /deliveryOwner/);
  assert.match(checkout, /seminar_registration_staging/);
  assert.match(webhooks, /staging:\$\{event\.id\}/);
  assert.match(webhooks, /session\.metadata\?\.deliveryOwner === 'staging'/);
  assert.match(stripeRoute, /stagingOwnedEvent/);
  assert.match(stripeRoute, /delivery\.retryable > 0 \|\| delivery\.deadLettered > 0/);
  assert.match(stripeRoute, /status: 503/);
  assert.match(notices, /availableAt: sql`now\(\)`/);
  assert.match(notices, /STAGING_SEMINAR_CONFIRMATION_KIND/);
  assert.match(notices, /kind === 'seminar\.registration_created' \|\| kind === STAGING_SEMINAR_CONFIRMATION_KIND/);
});


test('every completed profile-backed seminar registration lands on My Seminars', () => {
  const memberActions = readFileSync('app/(dashboard)/dashboard/seminars/actions.ts', 'utf8');
  const checkout = readFileSync('lib/seminars/checkout.ts', 'utf8');

  assert.match(memberActions, /outcome\.paymentMethod === 'cash_event' \|\| outcome\.paymentMethod === 'bank_transfer'[\s\S]*return \{ redirectTo: '\/seminars\?view=my' \}/);
  assert.match(checkout, /success_url: `\$\{baseUrl\}\/seminars\?view=my`/);
});


test('offline profile registrations expose a reliable My Seminars client navigation target', () => {
  const actions = readFileSync('app/(dashboard)/dashboard/seminars/actions.ts', 'utf8');
  const cta = readFileSync('components/seminars/seminar-register-cta.tsx', 'utf8');

  assert.match(actions, /return \{ redirectTo: '\/seminars\?view=my' \}/);
  assert.match(cta, /window\.location\.replace\(state\.redirectTo\)/);
});

test('registered profiles do not get a redundant management box on seminar detail pages', () => {
  const detailPage = readFileSync('app/(marketing)/seminars/[id]/page.tsx', 'utf8');
  assert.doesNotMatch(detailPage, /Manage in My Seminars/);
  assert.doesNotMatch(detailPage, /Your registration:/);
  assert.match(detailPage, /alreadyRegistered \? null/);
});


test('My Seminars cancel action uses the same subtle table-control styling as admin filters', () => {
  const source = readFileSync('components/seminars/member-registrations.tsx', 'utf8');
  const form = readFileSync('components/seminars/seminar-form.tsx', 'utf8');
  assert.match(source, /buttonTableControl/);
  assert.match(source, /border-dashed/);
  assert.match(form, /data-idoc-table-control/);
});

test('seminar confirmation email renders full spelled-out calendar dates', () => {
  const source = readFileSync('lib/seminars/registrations.ts', 'utf8');
  assert.match(source, /formatDate\(dateOnly\(seminar\.start_date\)\)/);
  assert.match(source, /Registration deadline: \$\{escapeHtml\(formatDate\(dateOnly\(seminar\.registration_deadline\)\)\)\}/);
});


test('member manual registration returns My Seminars before any seminar revalidation', () => {
  const actions = readFileSync('app/(dashboard)/dashboard/seminars/actions.ts', 'utf8');
  const manualReturn = actions.indexOf("return { redirectTo: '/seminars?view=my' }");
  const seminarRevalidation = actions.indexOf("revalidatePath('/seminars')");
  assert.ok(manualReturn >= 0, 'manual member registration must return a My Seminars target');
  assert.ok(seminarRevalidation >= 0, 'seminar revalidation should still exist for non-manual paths');
  assert.ok(manualReturn < seminarRevalidation, 'manual registration redirect must be returned before revalidation can unmount the CTA');
});


test('seminar payment-method choices use the same subtle table-control treatment as cancel registration', () => {
  const cta = readFileSync('components/seminars/seminar-register-cta.tsx', 'utf8');
  assert.match(cta, /data-idoc-table-control=""/);
  assert.match(cta, /border-dashed/);
  assert.match(cta, /rounded-md/);
  assert.match(cta, /font-normal/);
});


test('seminar detail rich-information section headings use the defined gold accent token', () => {
  const detail = readFileSync('app/(marketing)/seminars/[id]/page.tsx', 'utf8');
  assert.match(detail, /text-gold/);
  assert.doesNotMatch(detail, /text-orange/);
});




test('registration is members-only: guest registration, guest checkout, and non-member pricing are gone from code, UI, and the webhook', () => {
  for (const removed of ['lib/seminars/guest-registration-validation.ts', 'app/(marketing)/seminars/actions.ts', 'components/seminars/seminar-registration-form.tsx']) {
    assert.equal(existsSync(removed), false, `${removed} must be deleted`);
  }
  assert.doesNotMatch(registrationsSource, /registerAsGuestForSeminar|registerForSeminarAtNonMemberPrice|guestEmailSchema|non_member_price_cents|organizing_national_federation/);
  assert.doesNotMatch(checkoutSource, /createGuestSeminarCheckoutSession|non_member_price_cents|seminar_guest_registration/);
  assert.doesNotMatch(memberActions, /registerAtNonMemberPriceAction|NonMemberPrice/);
  assert.doesNotMatch(seminarsSource, /nonMemberPrice|organizingNationalFederation/);
  const cta = readFileSync('components/seminars/seminar-register-cta.tsx', 'utf8');
  assert.doesNotMatch(cta, /guest|Guest|Turnstile|sign-up/);
  assert.match(cta, /Choose a payment method/);
  assert.match(cta, /window\.location\.replace\(state\.redirectTo\)/);
  const webhookSource = readFileSync('lib/payments/webhook-handlers.ts', 'utf8');
  assert.doesNotMatch(webhookSource, /nonMemberPriceCents|guest\.seminar_registration\.registered_and_paid|handleRetiredGuestSeminarCheckoutSessionCompleted|refundGuestCheckoutWithoutRegistration/);
});

test('a signed-out or non-entitled visitor sees the seminar/course details but never a Register action, and the server independently enforces entitlement', () => {
  const detailPage = readFileSync('app/(marketing)/seminars/[id]/page.tsx', 'utf8');
  assert.match(detailPage, /isEntitledMember \? \(\s*<SeminarRegisterCta/);
  assert.match(detailPage, /Only signed-in IDOC members can register/);
  assert.match(detailPage, /An active IDOC membership is required to register/);
  assert.doesNotMatch(detailPage, /Organizing National Federation|Non-members|ownProfileDetails|memberDetails/);
  assert.match(registrationsSource, /export async function registerForSeminar\([\s\S]*requireOwnProfileId\(\)/);
  assert.match(registrationsSource, /requireAccountAccess\('member'\)/);
});

test('every user-facing "Seminars" label reads Seminars/Courses', () => {
  const header = readFileSync('components/site/Header.tsx', 'utf8');
  const listing = readFileSync('app/(marketing)/seminars/page.tsx', 'utf8');
  assert.match(header, /label: 'Seminars\/Courses'/);
  assert.match(listing, /title="Seminars\/Courses"/);
  assert.match(listing, /Available Seminars\/Courses/);
  assert.match(listing, /My Seminars\/Courses/);
});

test('the registration approval status ("Registration Status") is independent of payment: non-FEI is Confirmed at registration, FEI starts Pending FEI Approval', () => {
  assert.deepEqual([...APPROVAL_STATUSES], ['confirmed', 'pending_fei_approval', 'approved_by_fei', 'not_approved_by_fei', 'approved_audit_only_by_fei']);
  assert.deepEqual(FEI_APPROVAL_STATUSES, ['pending_fei_approval', 'approved_by_fei', 'not_approved_by_fei', 'approved_audit_only_by_fei']);
  assert.equal(initialApprovalStatus(false), 'confirmed');
  assert.equal(initialApprovalStatus(true), 'pending_fei_approval');
  assert.equal(APPROVAL_STATUS_LABELS.approved_audit_only_by_fei, 'Approved to Audit Only by FEI');
  assert.match(approvalMigration, /ADD COLUMN IF NOT EXISTS "approval_status" varchar\(30\) DEFAULT 'confirmed' NOT NULL/);
  assert.match(approvalMigration, /"approval_status" in \('confirmed', 'pending_fei_approval', 'approved_by_fei', 'not_approved_by_fei', 'approved_audit_only_by_fei'\)/);
  assert.match(approvalMigration, /SET "approval_status" = 'pending_fei_approval'[\s\S]*s\."is_fei" = true/);
  // Both self-registration and admin-created registration set it from the seminar's FEI flag.
  assert.equal((registrationsSource.match(/initialApprovalStatus\(seminar\.is_fei\)/g) ?? []).length, 2);
  assert.doesNotMatch(registrationsSource, /approval_status='confirmed',paid_at/);
});

test('an administrator can record the FEI decision; it is validated, audited, and emails the registrant the confirmation details plus a clear status message', () => {
  const fn = registrationsSource.match(/export async function setAdminRegistrationApprovalStatus[\s\S]*?\n\}\n/)?.[0];
  assert.ok(fn, 'setAdminRegistrationApprovalStatus not found');
  assert.match(fn as string, /requireSeminarAdministrator\(\)/);
  assert.match(fn as string, /FEI registration statuses only apply to FEI seminars/);
  assert.match(fn as string, /admin\.seminar_registration\.approval_status_changed/);
  assert.match(fn as string, /FEI_APPROVAL_STATUSES as readonly string\[\]\)\.includes\(status\)/);
  assert.match(fn as string, /'statusUpdate',true/);
  assert.match(registrationsSource, /Your National Federation must register you with the FEI in order for you to be approved to participate/);
  assert.match(registrationsSource, /registrationStatusMessageHtml\(approvalStatus\)/);
  const notices = readFileSync('lib/notifications/renewal-notices.ts', 'utf8');
  assert.match(notices, /statusUpdate: payload\.statusUpdate \?\? false/);
  assert.match(notices, /Your IDOC seminar registration status: \$\{statusLabel\}/);
});

test('an administrator creates a registration by looking up an active member, which sends the same confirmation email as self-registration', () => {
  const fn = registrationsSource.match(/export async function createAdminSeminarRegistration[\s\S]*?\n\}\n/)?.[0];
  assert.ok(fn, 'createAdminSeminarRegistration not found');
  assert.doesNotMatch(fn as string, /guest_|guestName|fields\.email|fields\.phone/);
  assert.match(fn as string, /Registrations can only be created for active members/);
  assert.match(fn as string, /join users u on u\.id=p\.user_id and u\.deleted_at is null and u\.account_state='active'/);
  assert.match(fn as string, /seminar\.registration_created/);
  assert.match(registrationsSource, /export async function searchActiveMembersForRegistration/);
  const drawer = readFileSync('app/(dashboard)/admin/seminars/registrations/registration-create-drawer.tsx', 'utf8');
  assert.match(drawer, /<MemberLookup \/>/);
  assert.doesNotMatch(drawer, /name="firstName"|name="lastName"|name="email"|name="phone"/);
  // Seminar and payment method sit side by side at 50% each on desktop.
  assert.match(drawer, /grid gap-4 sm:grid-cols-2[\s\S]*name="seminarId"[\s\S]*name="paymentMethod"/);
});

test('an administrator recording a seminar payment queues the Seminar payment confirmed notice in the same transaction', () => {
  const source = readFileSync('lib/seminars/registrations.ts', 'utf8');
  const start = source.indexOf('export async function recordManualSeminarPayment');
  const body = source.slice(start, source.indexOf('export async function', start + 10));
  assert.match(body, /payment_status='paid'/);
  assert.match(body, /'seminar\.payment_confirmed'/);
  // staging owns its notice (production never claims it) and the action drains it, like every registration confirmation.
  assert.match(body, /isStagingSeminarDirectDelivery\(\) \? 'seminar\.staging_payment_confirmed' : 'seminar\.payment_confirmed'/);
  assert.match(readFileSync('app/(dashboard)/admin/seminars/actions.ts', 'utf8'), /queues the payment notice under its own kind[^\n]*\n\s+if \(isStagingSeminarDirectDelivery\(\)\) await processStagingSeminarConfirmationBatch\(\)/);
  assert.match(readFileSync('lib/notifications/renewal-notices.ts', 'utf8'), /kind in \(\$\{STAGING_SEMINAR_CONFIRMATION_KIND\}, \$\{STAGING_SEMINAR_PAYMENT_KIND\}\)/);
  assert.match(body, /seminar\.payment_confirmed:\$\{registrationId\.data\}:manual/);
  assert.match(body, /on conflict\(dedupe_key\) do nothing/);
  // The notice is queued inside the client.begin transaction that records the payment.
  assert.ok(body.indexOf("'seminar.payment_confirmed'") > body.indexOf("payment_status='paid'"));
  assert.ok(body.indexOf('client.begin') < body.indexOf("payment_status='paid'"));
});
