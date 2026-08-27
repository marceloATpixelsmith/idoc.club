import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('app/(dashboard)/onboarding/onboarding-wizard.tsx', 'utf8');
const autocompleteRoute = await readFile('app/api/address/autocomplete/route.ts', 'utf8');
const countriesSource = await readFile('lib/membership/countries.ts', 'utf8');
const envExample = await readFile('.env.example', 'utf8');
const providerContract = await readFile('docs/15-international-address-autocomplete-security-and-operations.md', 'utf8');
const onboardingBehavior = await readFile('docs/16-onboarding-demographic-form-behavior.md', 'utf8');
const rateLimitSource = await readFile('lib/security/rate-limit.ts', 'utf8');

test('profile creation remains disabled until all required details and consents are complete', () => {
  assert.match(source, /form\.checkValidity\(\)/);
  assert.match(source, /getAll\('judgeStatus'\)\.length === 0/);
  assert.match(source, /getAll\('stewardStatus'\)\.length === 0/);
  assert.match(source, /disabled=\{pending \|\| !detailsComplete\}/);
  assert.match(source, /<ConsentCheckbox name="termsAccepted" required>/);
  assert.match(source, /<ConsentCheckbox name="privacyAccepted" required>/);
});

test('readiness is recomputed for restored and browser-autofilled form values', () => {
  assert.match(source, /useRef<HTMLFormElement>\(null\)/);
  assert.match(source, /ref=\{detailsFormRef\}/);
  assert.match(source, /syncReadiness\(\);/);
  assert.match(source, /requestAnimationFrame\(syncReadiness\)/);
  assert.match(source, /setTimeout\(syncReadiness, 250\)/);
  assert.match(source, /setTimeout\(syncReadiness, 1000\)/);
  assert.match(source, /addEventListener\('pageshow', syncReadiness\)/);
});

test('onboarding field labels stay bold and section headers are uppercase without enclosing boxes', () => {
  for (const label of [
    'Country',
    'National Federation',
    'IDOC Region',
    'FEI ID',
    'Official status as Judge',
    'Official status as Steward',
    'Are you a Technical Delegate?',
  ]) assert.ok(source.includes(label), `missing onboarding label: ${label}`);

  for (const heading of ['ADDRESS', 'OFFICIAL INFORMATION', 'CONSENT']) {
    assert.ok(source.includes(`>${heading}</legend>`), `missing uppercase section heading: ${heading}`);
  }

  assert.ok((source.match(/font-bold/g) ?? []).length >= 8, 'expected bold field and section labels');
  assert.match(source, /className="space-y-9"/);
  assert.match(source, /fieldset className="space-y-4 border-0 p-0"/);
  assert.doesNotMatch(source, /fieldset className="space-y-[34] rounded-lg border border-gray-200 p-4"/);
});

test('going back to classification clears stale form readiness', () => {
  assert.match(source, /setDetailsComplete\(false\); setStep\('type'\)/);
  assert.match(source, /setClassification\(option\.value\); setDetailsComplete\(false\)/);
});

test('country selectors display names while preserving ISO alpha-2 values', () => {
  assert.match(countriesSource, /new Intl\.DisplayNames\(\['en'\], \{ type: 'region' \}\)/);
  assert.match(countriesSource, /\{ code, name:/);
  assert.match(source, /COUNTRY_OPTIONS\.map\(\(\{ code, name: countryName \}\)/);
  assert.match(source, /value=\{code\}>\{countryName\}/);
});

test('national federation defaults from address country without overwriting an explicit federation', () => {
  assert.match(source, /const \[nationalFederationCountryCode, setNationalFederationCountryCode\] = useState\(''\)/);
  assert.match(source, /const \[federationWasManuallyEdited, setFederationWasManuallyEdited\] = useState\(false\)/);
  assert.match(source, /if \(!nationalFederationCountryCode \|\| !federationWasManuallyEdited\)/);
  assert.match(source, /setNationalFederationCountryCode\(nextCountryCode\)/);
  assert.match(source, /function handleFederationChange/);
  assert.match(source, /setFederationWasManuallyEdited\(Boolean\(nextFederationCountryCode\)\)/);
  assert.match(source, /onChange=\{handleFederationChange\}/);
  assert.match(source, /value=\{nationalFederationCountryCode\}/);
});

test('federation default behavior is documented as member-field contract', () => {
  assert.match(onboardingBehavior, /National Federation is a required professional field and remains fully editable/);
  assert.match(onboardingBehavior, /must not overwrite that explicitly selected federation/);
  assert.match(onboardingBehavior, /If the member clears National Federation, it becomes eligible for automatic defaulting again/);
});

test('address entry is country-first with Geoapify-assisted structured population and manual fallback', () => {
  assert.ok(source.indexOf('htmlFor="countryCode"') < source.indexOf('htmlFor="address1"'));
  assert.match(source, /disabled=\{!countryCode\}/);
  assert.match(source, /\/api\/address\/autocomplete/);
  assert.match(source, /setCity\(suggestion\.city\)/);
  assert.match(source, /setStateProvince\(suggestion\.stateProvince\)/);
  assert.match(source, /setPostalCode\(suggestion\.postalCode\)/);
  assert.match(source, /enter the address manually/);
  assert.match(source, /Powered by Geoapify/);
});

test('Geoapify attribution is visually secondary to the address helper text', () => {
  assert.match(source, /text-right text-\[10px\] text-gray-400/);
  assert.match(source, /underline decoration-gray-300 underline-offset-2/);
});

test('changing address country clears stale structured address values', () => {
  assert.match(source, /function handleCountryChange/);
  for (const reset of ['setAddress1', 'setAddress2', 'setCity', 'setStateProvince', 'setPostalCode']) {
    assert.match(source, new RegExp(`${reset}\\(''\\)`));
  }
});

test('Geoapify credential remains server-only and autocomplete is limited to authenticated users and selected country', () => {
  assert.match(autocompleteRoute, /import 'server-only'/);
  assert.match(autocompleteRoute, /const user = await getUser\(\)/);
  assert.match(autocompleteRoute, /status: 401/);
  assert.match(autocompleteRoute, /process\.env\.GEOAPIFY_API_KEY/);
  assert.doesNotMatch(autocompleteRoute, /NEXT_PUBLIC_GEOAPIFY/);
  assert.match(autocompleteRoute, /filter', `countrycode:\$\{country\.toLowerCase\(\)\}`/);
  assert.match(envExample, /^GEOAPIFY_API_KEY=\*\*\*$/m);
});

test('shared Geoapify provider quota is bounded by independent account and request-origin limits', () => {
  assert.match(autocompleteRoute, /checkProviderRateLimit\('address_autocomplete', String\(user\.id\), origin\)/);
  assert.match(autocompleteRoute, /status: 429/);
  assert.match(autocompleteRoute, /'Retry-After': '900'/);
  assert.match(rateLimitSource, /PROVIDER_USER_MAX_REQUESTS = 60/);
  assert.match(rateLimitSource, /PROVIDER_ORIGIN_MAX_REQUESTS = 180/);
  assert.match(rateLimitSource, /provider-account/);
  assert.match(rateLimitSource, /provider-origin/);
});

test('Geoapify privacy, credential rotation, availability, and failure contracts are documented', () => {
  const normalizedContract = providerContract.toLowerCase();
  for (const required of [
    'partial home-address text',
    'geoapify_api_key',
    'credential rotation',
    'manual address entry',
    '60 provider calls per account',
    '180 provider calls per request origin',
    'must not send the member\'s name, email address, fei id',
  ]) assert.ok(normalizedContract.includes(required), `missing provider contract detail: ${required}`);
});
