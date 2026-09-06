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

test('region default behavior is documented as member-field contract', () => {
  assert.match(onboardingBehavior, /IDOC Region is a required professional field and remains fully editable/);
  assert.match(onboardingBehavior, /must not overwrite that explicitly selected region/);
  assert.match(onboardingBehavior, /Mexico defaults to Central & Latin America, not North America/);
});

test('geolocation bias and locality-field behavior are documented as member-field contract', () => {
  assert.match(onboardingBehavior, /never gates or delays typing/);
  assert.match(onboardingBehavior, /colonia on a Mexican address/);
  assert.match(onboardingBehavior, /copies that value into Address 2 automatically/);
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

test('IDOC Region defaults from address country without overwriting an explicit manual selection', () => {
  assert.match(source, /import \{ IDOC_REGION_BY_COUNTRY \} from '@\/lib\/membership\/idoc-regions-by-country'/);
  assert.match(source, /const \[idocRegion, setIdocRegion\] = useState\(''\)/);
  assert.match(source, /const \[regionWasManuallyEdited, setRegionWasManuallyEdited\] = useState\(false\)/);
  assert.match(source, /if \(!regionWasManuallyEdited\)/);
  assert.match(source, /setIdocRegion\(nextCountryCode \? IDOC_REGION_BY_COUNTRY\[nextCountryCode\] \?\? '' : ''\)/);
  assert.match(source, /function handleRegionChange/);
  assert.match(source, /setRegionWasManuallyEdited\(Boolean\(nextRegion\)\)/);
  assert.match(source, /onChange=\{handleRegionChange\}/);
  assert.match(source, /id="idocRegion".*value=\{idocRegion\}/);
});

test('the IDOC Region default table maps every ISO country code to a valid IDOC Region exactly once', async () => {
  const { ISO_COUNTRY_CODES, IDOC_REGIONS } = await import('../lib/membership/validation.ts');
  const { IDOC_REGION_BY_COUNTRY } = await import('../lib/membership/idoc-regions-by-country.ts');
  const mapped = Object.keys(IDOC_REGION_BY_COUNTRY);
  assert.deepEqual(mapped.slice().sort(), ISO_COUNTRY_CODES.slice().sort());
  for (const code of ISO_COUNTRY_CODES) {
    assert.ok((IDOC_REGIONS as readonly string[]).includes(IDOC_REGION_BY_COUNTRY[code]), `${code} maps to an invalid region`);
  }
});

test('address autocomplete is biased by a best-effort, non-blocking browser geolocation hint', () => {
  assert.match(source, /const \[geolocationBias, setGeolocationBias\] = useState<\{ lat: number; lon: number \} \| null>\(null\)/);
  assert.match(source, /navigator\.geolocation\.getCurrentPosition\(/);
  assert.match(source, /setGeolocationBias\(\{ lat: position\.coords\.latitude, lon: position\.coords\.longitude \}\)/);
  assert.match(source, /params\.set\('lat', String\(geolocationBias\.lat\)\)/);
  assert.match(source, /params\.set\('lon', String\(geolocationBias\.lon\)\)/);
  assert.match(autocompleteRoute, /endpoint\.searchParams\.set\('bias', `proximity:\$\{lon\},\$\{lat\}`\)/);
  // Bias is applied only after the existing text-length/country validation already passed --
  // never a basis on its own to accept or reject a request.
  assert.ok(autocompleteRoute.indexOf('if (text.length') < autocompleteRoute.indexOf("searchParams.set('bias'"));
});

test('a selected suggestion\'s finer-grained locality (e.g. a Mexican address\'s colonia) fills Address 2 automatically, and never clears an existing value when absent', () => {
  assert.match(autocompleteRoute, /district: result\.suburb \?\? result\.district \?\? ''/);
  assert.match(source, /if \(suggestion\.district\) setAddress2\(suggestion\.district\)/);
  const chooseAddressStart = source.indexOf('function chooseAddress');
  const chooseAddressEnd = source.indexOf('\n  }', chooseAddressStart);
  assert.ok(chooseAddressStart >= 0 && chooseAddressEnd > chooseAddressStart);
  assert.ok(source.indexOf('setAddress2', chooseAddressStart) < chooseAddressEnd, 'setAddress2 must be called from within chooseAddress');
  // A Codex review finding: an unconditional setAddress2(suggestion.district) would silently erase
  // a member's own manually-typed Address 2 the moment they picked any suggestion the provider
  // returned without a district/suburb field, contradicting the documented "leaves Address 2
  // untouched" behavior.
  assert.doesNotMatch(source.slice(chooseAddressStart, chooseAddressEnd), /(?<!if \(suggestion\.district\) )setAddress2\(suggestion\.district\)/);
});

// A Codex review finding: URLSearchParams.get() returns null for an absent param, and Number(null)
// is 0 -- a plausible-looking coordinate -- so without checking the raw params are actually present
// first, every request made before geolocation resolves (or after it's denied/unavailable) would
// silently bias toward the Gulf of Guinea (0,0) instead of staying unbiased.
test('an absent lat/lon never coerces to a false (0,0) proximity bias', () => {
  assert.match(autocompleteRoute, /const rawLat = searchParams\.get\('lat'\)/);
  assert.match(autocompleteRoute, /const rawLon = searchParams\.get\('lon'\)/);
  assert.match(autocompleteRoute, /const hasBias = rawLat !== null && rawLon !== null/);
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
    'their current coordinates are also disclosed to geoapify',
    'a denied, dismissed, or unavailable permission simply leaves every request unbiased',
    'the only page in the application granted the browser\'s geolocation permission',
  ]) assert.ok(normalizedContract.includes(required), `missing provider contract detail: ${required}`);
});
