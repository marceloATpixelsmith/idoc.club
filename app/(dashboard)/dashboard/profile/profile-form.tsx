'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COUNTRY_OPTIONS } from '@/lib/membership/countries';
import { IDOC_REGION_BY_COUNTRY } from '@/lib/membership/idoc-regions-by-country';
import { IDOC_REGIONS, JUDGE_STATUSES, STEWARD_STATUSES } from '@/lib/membership/validation';
import { saveOwnAccountAndProfileForm } from '@/app/(dashboard)/account/actions';

type Role = { feiId: string | null; idocRegion: string | null; isTechnicalDelegate: boolean | null; nationalFederationCountryCode: string | null; officialStatuses: string[] | null; roleType: string };
type Member = { profile: Record<string, unknown>; roles: Role[] };
type Classification = 'judge' | 'judge_steward' | 'steward' | 'veterinarian';

type AddressSuggestion = {
  addressLine1: string;
  city: string;
  country: string;
  countryCode: string;
  district: string;
  formatted: string;
  postalCode: string;
  stateProvince: string;
};

// Matches lib/db/schema.ts's profiles column lengths (memberProfileSchema enforces the same limits
// server-side; this is the client-side half of the same requirement).
const FIELD_MAX_LENGTH: Record<string, number> = {
  address1: 200, address2: 200, city: 100, firstName: 100, lastName: 100, postalCode: 30, stateProvince: 100,
};

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function ProfileForm({ email, member }: { email: string; member: Member | null }) {
  const judge = member?.roles.find((role) => role.roleType === 'judge');
  const steward = member?.roles.find((role) => role.roleType === 'steward');
  const official = judge ?? steward;
  const initialClassification: Classification = judge && steward ? 'judge_steward' : ((judge?.roleType ?? steward?.roleType) as Classification | undefined) ?? 'veterinarian';
  const [classification, setClassification] = useState<Classification>(initialClassification);

  const [countryCode, setCountryCode] = useState(str(member?.profile.countryCode));
  const [nationalFederationCountryCode, setNationalFederationCountryCode] = useState(official?.nationalFederationCountryCode ?? '');
  // An existing, already-saved value represents a deliberate choice -- editing the street address's
  // country later must never silently overwrite it the way a blank onboarding form's convenience
  // default does; only a field that started (or becomes) blank auto-fills from the address country.
  const [federationWasManuallyEdited, setFederationWasManuallyEdited] = useState(Boolean(official?.nationalFederationCountryCode));
  const [idocRegion, setIdocRegion] = useState(official?.idocRegion ?? '');
  const [regionWasManuallyEdited, setRegionWasManuallyEdited] = useState(Boolean(official?.idocRegion));

  const [address1, setAddress1] = useState(str(member?.profile.address1));
  const [address2, setAddress2] = useState(str(member?.profile.address2));
  const [address2WasManuallyEdited, setAddress2WasManuallyEdited] = useState(false);
  const [city, setCity] = useState(str(member?.profile.city));
  const [stateProvince, setStateProvince] = useState(str(member?.profile.stateProvince));
  const [postalCode, setPostalCode] = useState(str(member?.profile.postalCode));
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [autocompleteAvailable, setAutocompleteAvailable] = useState(true);
  // The pre-filled address already on file counts as "chosen" -- typing in it shouldn't immediately
  // show a suggestions dropdown before the member has actually changed anything.
  const [selectedAddressValue, setSelectedAddressValue] = useState(str(member?.profile.address1));
  const [geolocationBias, setGeolocationBias] = useState<{ lat: number; lon: number } | null>(null);

  const [state, submit, pending, stepUpDialog] = useFreshStepUpAction(saveOwnAccountAndProfileForm, {});

  useEffect(() => {
    // A one-time, best-effort bias hint for ranking autocomplete suggestions -- never blocks or
    // delays typing: an unavailable API, a denied/dismissed permission prompt, or any error just
    // leaves suggestions unbiased.
    if (!member || typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => setGeolocationBias({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => {},
      { maximumAge: 300_000, timeout: 5000 },
    );
  }, [member]);

  useEffect(() => {
    const query = address1.trim();
    if (!member || !countryCode || query.length < 3 || query === selectedAddressValue) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ country: countryCode, text: query });
        if (geolocationBias) {
          params.set('lat', String(geolocationBias.lat));
          params.set('lon', String(geolocationBias.lon));
        }
        const response = await fetch(`/api/address/autocomplete?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          setAutocompleteAvailable(false);
          setSuggestions([]);
          return;
        }
        const payload = await response.json() as { available?: boolean; suggestions?: AddressSuggestion[] };
        setAutocompleteAvailable(payload.available !== false);
        setSuggestions(payload.suggestions ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setAutocompleteAvailable(false);
        setSuggestions([]);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [address1, countryCode, geolocationBias, member, selectedAddressValue]);

  function handleCountryChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextCountryCode = event.target.value;
    setCountryCode(nextCountryCode);
    if (!federationWasManuallyEdited) setNationalFederationCountryCode(nextCountryCode);
    if (!regionWasManuallyEdited) setIdocRegion(nextCountryCode ? IDOC_REGION_BY_COUNTRY[nextCountryCode] ?? '' : '');
    setAddress1('');
    setAddress2('');
    setAddress2WasManuallyEdited(false);
    setCity('');
    setStateProvince('');
    setPostalCode('');
    setSelectedAddressValue('');
    setSuggestions([]);
    setAutocompleteAvailable(true);
  }

  function handleFederationChange(event: ChangeEvent<HTMLSelectElement>) {
    setNationalFederationCountryCode(event.target.value);
    setFederationWasManuallyEdited(Boolean(event.target.value));
  }

  function handleRegionChange(event: ChangeEvent<HTMLSelectElement>) {
    setIdocRegion(event.target.value);
    setRegionWasManuallyEdited(Boolean(event.target.value));
  }

  function chooseAddress(suggestion: AddressSuggestion) {
    const line1 = suggestion.addressLine1 || suggestion.formatted;
    setAddress1(line1);
    setSelectedAddressValue(line1);
    if (suggestion.district && !address2WasManuallyEdited) setAddress2(suggestion.district);
    setCity(suggestion.city);
    setStateProvince(suggestion.stateProvince);
    setPostalCode(suggestion.postalCode);
    setSuggestions([]);
  }

  return <>
    <div className="mt-6 max-w-3xl rounded-lg border p-5">
      <form action={submit} className="space-y-8">
        <CsrfField />

        <fieldset className="space-y-4 border-0 p-0">
          <legend className="mb-1 w-full text-sm font-bold uppercase tracking-wider text-gold">Account</legend>
          <div className="max-w-sm">
            <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="email">Email</Label>
            <Input defaultValue={email} id="email" name="email" required type="email" />
          </div>
        </fieldset>

        {member ? <>
          <fieldset className="space-y-4 border-0 border-t border-border p-0 pt-6">
            <legend className="mb-1 w-full text-sm font-bold uppercase tracking-wider text-gold">Personal information</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="firstName">First Name</Label>
                <Input defaultValue={str(member.profile.firstName)} id="firstName" maxLength={FIELD_MAX_LENGTH.firstName} name="firstName" required />
              </div>
              <div>
                <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="lastName">Last Name</Label>
                <Input defaultValue={str(member.profile.lastName)} id="lastName" maxLength={FIELD_MAX_LENGTH.lastName} name="lastName" required />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-4 border-0 border-t border-border p-0 pt-6">
            <legend className="mb-1 w-full text-sm font-bold uppercase tracking-wider text-gold">Address</legend>
            <div className="max-w-sm">
              <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="countryCode">Country</Label>
              <CountrySelect id="countryCode" name="countryCode" onChange={handleCountryChange} value={countryCode} />
            </div>

            <div className="relative">
              <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="address1">Address 1</Label>
              <Input
                aria-autocomplete="list"
                aria-controls="profile-address-suggestions"
                autoComplete="street-address"
                disabled={!countryCode}
                id="address1"
                maxLength={FIELD_MAX_LENGTH.address1}
                name="address1"
                onChange={(event) => {
                  setAddress1(event.target.value);
                  if (event.target.value !== selectedAddressValue) setSelectedAddressValue('');
                }}
                placeholder={countryCode ? 'Start typing your address' : 'Choose a country first'}
                required
                value={address1}
              />
              {suggestions.length > 0 ? (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg" id="profile-address-suggestions" role="listbox">
                  {suggestions.map((suggestion, index) => (
                    <button
                      className="block w-full border-b border-border px-3 py-2 text-left text-sm text-foreground last:border-0 hover:bg-surface"
                      key={`${suggestion.formatted}-${index}`}
                      onClick={() => chooseAddress(suggestion)}
                      onMouseDown={(event) => event.preventDefault()}
                      type="button"
                    >
                      {suggestion.formatted}
                    </button>
                  ))}
                </div>
              ) : null}
              {countryCode ? (
                <div className="mt-1">
                  <p className="text-xs text-muted-foreground">
                    {autocompleteAvailable ? 'Choose a suggestion to fill Address 2, city, region, and postal code automatically, or enter the address manually.' : 'Address autocomplete is unavailable right now. You can still enter the address manually.'}
                  </p>
                  <p className="mt-0.5 text-right text-[10px] text-gray-400">
                    <a className="underline decoration-gray-300 underline-offset-2" href="https://www.geoapify.com/" rel="noreferrer" target="_blank">Powered by Geoapify</a>
                  </p>
                </div>
              ) : null}
            </div>

            <div>
              <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="address2">Address 2 (optional)</Label>
              <Input
                autoComplete="address-line2"
                id="address2"
                maxLength={FIELD_MAX_LENGTH.address2}
                name="address2"
                onChange={(event) => { setAddress2(event.target.value); setAddress2WasManuallyEdited(true); }}
                value={address2}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="city">City</Label>
                <Input autoComplete="address-level2" id="city" maxLength={FIELD_MAX_LENGTH.city} name="city" onChange={(event) => setCity(event.target.value)} required value={city} />
              </div>
              <div>
                <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="stateProvince">State/Province</Label>
                <Input autoComplete="address-level1" id="stateProvince" maxLength={FIELD_MAX_LENGTH.stateProvince} name="stateProvince" onChange={(event) => setStateProvince(event.target.value)} required value={stateProvince} />
              </div>
              <div>
                <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="postalCode">ZIP/postal code</Label>
                <Input autoComplete="postal-code" id="postalCode" maxLength={FIELD_MAX_LENGTH.postalCode} name="postalCode" onChange={(event) => setPostalCode(event.target.value)} required value={postalCode} />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-4 border-0 border-t border-border p-0 pt-6">
            <legend className="mb-1 w-full text-sm font-bold uppercase tracking-wider text-gold">Professional classification</legend>
            <div className="max-w-sm">
              <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="classification">Classification</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm"
                id="classification"
                name="classification"
                onChange={(event) => setClassification(event.target.value as Classification)}
                value={classification}
              >
                <option value="judge">Judge</option>
                <option value="steward">Steward</option>
                <option value="judge_steward">Judge + Steward</option>
                <option value="veterinarian">Veterinarian</option>
              </select>
            </div>
          </fieldset>

          {classification !== 'veterinarian' ? (
            <fieldset className="space-y-4 border-0 border-t border-border p-0 pt-6">
              <legend className="mb-1 w-full text-sm font-bold uppercase tracking-wider text-gold">Official information</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="nationalFederationCountryCode">National Federation</Label>
                  <CountrySelect id="nationalFederationCountryCode" name="nationalFederationCountryCode" onChange={handleFederationChange} value={nationalFederationCountryCode} />
                </div>
                <div>
                  <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="idocRegion">IDOC Region</Label>
                  <select className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm" id="idocRegion" name="idocRegion" onChange={handleRegionChange} required value={idocRegion}>
                    <option value="">Select</option>
                    {IDOC_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2 sm:max-w-sm">
                  <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="feiId">FEI ID (optional)</Label>
                  <Input defaultValue={official?.feiId ?? ''} id="feiId" name="feiId" />
                </div>
              </div>

              {classification === 'judge' || classification === 'judge_steward' ? <>
                <CheckboxGroup initial={judge?.officialStatuses ?? []} label="Official Status as Judge" name="judgeStatus" values={JUDGE_STATUSES} />
                <div className="max-w-xs">
                  <Label className="mb-1.5 block text-sm font-semibold text-foreground" htmlFor="isTechnicalDelegate">Technical Delegate</Label>
                  <select className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm" defaultValue={judge?.isTechnicalDelegate ? 'yes' : 'no'} id="isTechnicalDelegate" name="isTechnicalDelegate" required>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
              </> : null}
              {classification === 'steward' || classification === 'judge_steward' ? (
                <CheckboxGroup initial={steward?.officialStatuses ?? []} label="Official Status as Steward" name="stewardStatus" values={STEWARD_STATUSES} />
              ) : null}
            </fieldset>
          ) : null}
        </> : null}

        {state.error ? <p className="text-sm text-red-400" role="alert">{state.error}</p> : null}
        {state.success ? <p className="text-sm text-green-400">{state.success}</p> : null}
        <Button disabled={pending} type="submit">{pending ? <AuthPendingLabel text="Saving" /> : 'Save changes'}</Button>
      </form>
    </div>
    {stepUpDialog}
  </>;
}

function CountrySelect({ id, name, onChange, value }: { id: string; name: string; onChange?: (event: ChangeEvent<HTMLSelectElement>) => void; value: string }) {
  return (
    <select className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm" id={id} name={name} onChange={onChange} required value={value}>
      <option value="">Select country</option>
      {COUNTRY_OPTIONS.map(({ code, name: countryName }) => <option key={code} value={code}>{countryName}</option>)}
    </select>
  );
}

function CheckboxGroup({ initial, label, name, values }: { initial: string[]; label: string; name: string; values: readonly string[] }) {
  return (
    <fieldset className="space-y-1.5 border-0 p-0">
      <legend className="mb-1.5 block text-sm font-semibold text-foreground">{label}</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {values.map((value) => (
          <label className="flex items-center gap-2 text-sm text-foreground" key={value}>
            <input defaultChecked={initial.includes(value)} name={name} type="checkbox" value={value} />
            {value}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
