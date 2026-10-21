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
  assert.doesNotMatch(form, /Reference \/ evidence|PayPal/);
  // The evidence field only appears (and is only required) for the sources that need it, and every field is
  // controlled so a rejected submission does not clear what the administrator typed.
  assert.match(form, /bank_transfer: 'Bank Transfer Reference'/);
  assert.match(form, /cash: 'Receipt ID'/);
  assert.match(form, /stripe_manual: 'Stripe Payment ID'/);
  assert.match(form, /\{referenceLabel && \(/);
  assert.match(form, /<Label htmlFor="reference">\{referenceLabel\}<\/Label>/);
  assert.match(form, /id="reference" name="reference" required type="text"/);
  assert.match(form, /value=\{source\} onChange=/);
  assert.match(form, /value=\{reason\} onChange=/);
  // The reference input is not rendered for a complimentary grant, so the action must treat the missing field as undefined.
  assert.match(read('app/(dashboard)/admin/payments/actions.ts'), /reference: formData\.get\('reference'\) \?\? undefined,/);
  const server = read('lib/payments/manual-payments.ts');
  assert.match(server, /REFERENCE_REQUIRED_SOURCES: readonly ManualPaymentSource\[\] = \['stripe_manual', 'bank_transfer', 'cash'\]/);
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
  // The picker reports a one-day range on the first click, so the phase is tracked explicitly: first click anchors, second
  // click completes the range in either order, a third starts over.
  assert.match(filters, /const \[awaitingEnd, setAwaitingEnd\] = useState\(false\)/);
  assert.match(filters, /setRange\(\{ from: trigger, to: undefined \}\);\s+setAwaitingEnd\(true\)/);
  assert.match(filters, /trigger\.getTime\(\) < range\.from\.getTime\(\) \? \[trigger, range\.from\] : \[range\.from, trigger\]/);
  assert.doesNotMatch(filters, /if \(range\.from && range\.to\) setRange/);
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
    assert.match(source, /name="directoryEmailOptIn"( type="checkbox")?/);
    assert.doesNotMatch(source, /name="directoryEmailOptIn"[^>]*defaultChecked(?!=\{Boolean)/);
  }
  // On sign-up the directory opt-in sits inside the CONSENT section, after the other consent checkboxes.
  const onboarding = read('app/(dashboard)/onboarding/onboarding-wizard.tsx');
  assert.ok(onboarding.indexOf('name="keepUpdated"') < onboarding.indexOf('name="directoryEmailOptIn"'));
  assert.ok(onboarding.indexOf('name="directoryEmailOptIn"') < onboarding.indexOf('state.error'));
  assert.match(read('app/(dashboard)/onboarding/actions.ts'), /directoryEmailOptIn: formData\.get\('directoryEmailOptIn'\) === 'on'/);
  assert.match(migration, /"directory_email_opt_in" boolean DEFAULT false NOT NULL/);
  assert.match(read('lib/db/schema.ts'), /directoryEmailOptIn: boolean\('directory_email_opt_in'\)\.notNull\(\)\.default\(false\)/);
  // Admin corrections never silently flip the member's own choice: the field is only written when the form carries it.
  assert.match(read('lib/membership/validation.ts'), /formData\.has\('directoryEmailOptInField'\)/);
});

test('transactional emails serve their icons and the FEI logo from the app origin, and the FEI badge matches the seminar details page', async () => {
  const { existsSync, statSync } = await import('node:fs');
  const { IDOC_EMAIL_ICONS, idocEmailFeiLogoUrl } = await import('../lib/notifications/email-template.ts');
  const environment = { BASE_URL: 'https://staging.idoc.club/' } as unknown as NodeJS.ProcessEnv;
  // The third-party image host that used to serve the icons stopped resolving; no email source may point at it again.
  for (const file of ['lib/notifications/email-template.ts', 'lib/notifications/renewal-notices.ts', 'lib/seminars/registrations.ts']) {
    assert.doesNotMatch(read(file), /cloudinary/, `${file} must not reference the external icon host`);
  }
  // Every icon is a real PNG in /public (mail clients block SVG) and is reachable at the app origin.
  for (const key of ['banknote', 'calendar', 'deadline', 'flag', 'language', 'layers', 'location', 'users'] as const) {
    const url = IDOC_EMAIL_ICONS[key];
    assert.match(url, /^https:\/\/idoc\.club\/email-icons\/[a-z-]+\.png$/);
    const file = `public${new URL(url).pathname}`;
    assert.ok(existsSync(file) && statSync(file).size > 100, `${file} must exist`);
  }
  assert.equal(idocEmailFeiLogoUrl(environment), 'https://staging.idoc.club/fei-logo-email.png');
  assert.ok(existsSync('public/fei-logo-email.png'));
  // The confirmation email shows the FEI logo image (linked like the website badge), not the words "FEI SEMINAR".
  const registrations = read('lib/seminars/registrations.ts');
  assert.match(registrations, /seminar\.is_fei \? `<tr>.*href="https:\/\/www\.fei\.org\/dressage".*idocEmailFeiLogoUrl\(\)/);
  assert.doesNotMatch(registrations, /FEI SEMINAR/);
  // Rows mirror the website details card in the same order: dates, location, language, participants, price, levels, deadline, FEI.
  const order = ['IDOC_EMAIL_ICONS.calendar', 'IDOC_EMAIL_ICONS.location', 'IDOC_EMAIL_ICONS.language', 'IDOC_EMAIL_ICONS.users', 'IDOC_EMAIL_ICONS.banknote', 'IDOC_EMAIL_ICONS.layers', 'IDOC_EMAIL_ICONS.deadline'];
  const positions = order.map((name) => registrations.indexOf(`seminarEmailInfoRow(${name}`));
  assert.ok(positions.every((position, index) => position > 0 && (index === 0 || position > positions[index - 1])), 'email detail rows must follow the website order');
});

test('punchlist: day-first admin dates, Seminars/Courses admin label, create-registration statuses, and homepage partner sections', () => {
  assert.match(read('lib/seminars/format.ts'), /return `\$\{day\}\/\$\{month\}\/\$\{year\}`/);
  const fieldset = read('components/seminars/seminar-fieldset.tsx');
  assert.match(fieldset, /<DateRangePicker[^>]*fromName="startDate"[^>]*toName="endDate"/);
  assert.match(fieldset, /<SingleDatePicker[^>]*name="registrationDeadline"/);
  assert.match(read('components/admin-navigation.tsx'), /label: 'Seminars\/Courses'/);
  const create = read('app/(dashboard)/admin/seminars/registrations/registration-create-drawer.tsx');
  assert.match(create, /name="approvalStatus"/);
  assert.match(create, /name="paymentStatus"/);
  assert.match(read('app/(dashboard)/admin/seminars/registrations/page.tsx'), /listSeminarsOpenForAdminRegistration/);
  const home = read('app/(marketing)/page.tsx');
  for (const text of ['Dressage Results', 'FEI Officials &amp; Partners Clubs', 'Global Dressage Forum', 'IDRC', 'IDTC', 'IEOC', 'online.equipe.com']) assert.ok(home.includes(text), text);
});

test('an administrator-created Paid registration also queues the payment-confirmed notice', () => {
  const source = read('lib/seminars/registrations.ts');
  assert.match(source, /if \(markPaid\) \{[\s\S]*seminar\.staging_payment_confirmed[\s\S]*seminar\.payment_confirmed:admin:/);
});

test('countries are shown by name, never by their two-letter code, in the admin member form and everywhere else', async () => {
  const form = read('app/(dashboard)/admin/members/admin-profile-form.tsx');
  assert.match(form, /COUNTRY_SELECT_OPTIONS: SelectOption\[\] = COUNTRY_OPTIONS\.map\(\(\{ code, name \}\) => \(\{ label: name, value: code \}\)\)/);
  for (const field of ['countryCode', 'nationalFederationCountryCode']) {
    assert.match(form, new RegExp(`name="${field}" options=\\{COUNTRY_SELECT_OPTIONS\\}`), `${field} must list countries by name`);
  }
  // The option text is the label, the submitted value stays the ISO code.
  assert.match(form, /<option key=\{item\.value\} value=\{item\.value\}>\{item\.label\}<\/option>/);
  // No screen may render the raw code list (api routes may validate against it).
  const { readdirSync, statSync } = await import('node:fs');
  const files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = `${dir}/${name}`; if (statSync(path).isDirectory()) walk(path); else if (path.endsWith('.tsx')) files.push(path); } };
  walk('app'); walk('components');
  for (const file of files) assert.doesNotMatch(read(file), /ISO_COUNTRY_CODES/, `${file} must not list raw country codes`);
});
