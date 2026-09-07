'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COUNTRY_OPTIONS } from '@/lib/membership/countries';
import { IDOC_REGION_BY_COUNTRY } from '@/lib/membership/idoc-regions-by-country';
import { IDOC_REGIONS, JUDGE_STATUSES, STEWARD_STATUSES } from '@/lib/membership/validation';
import { CsrfField } from '@/components/security/csrf-field';
import type { MemberClassification } from '@/lib/membership/classification';
import { completeOnboarding } from './actions';

type Classification = MemberClassification;

type AddressSuggestion = {
  addressLine1: string;
  city: string;
  country: string;
  countryCode: string;
  // The finer-grained locality below city (e.g. a Mexican address's colonia), when the provider
  // returns one -- see chooseAddress, which copies this into Address 2.
  district: string;
  formatted: string;
  postalCode: string;
  stateProvince: string;
};

const TYPE_OPTIONS: { value: Classification; label: string; description: string }[] = [
  { value: 'judge', label: 'Judge', description: 'Officiate dressage competitions as a licensed judge.' },
  { value: 'steward', label: 'Steward', description: 'Oversee competition rules and welfare on the ground.' },
  { value: 'judge_steward', label: 'Judge + Steward', description: 'Hold both official capacities.' },
  { value: 'veterinarian', label: 'Veterinarian', description: 'Provide veterinary oversight at competitions.' },
];

function isDetailsFormComplete(form: HTMLFormElement, classification: Classification | null): boolean {
  if (!classification || !form.checkValidity()) return false;
  const data = new FormData(form);
  if ((classification === 'judge' || classification === 'judge_steward') && data.getAll('judgeStatus').length === 0) return false;
  if ((classification === 'steward' || classification === 'judge_steward') && data.getAll('stewardStatus').length === 0) return false;
  return true;
}

export function OnboardingWizard({ initialClassification = null }: { initialClassification?: Classification | null }) {
  const [state, action, pending] = useActionState<{ error?: string }, FormData>(completeOnboarding, {});
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [classification, setClassification] = useState<Classification | null>(initialClassification);
  const [detailsComplete, setDetailsComplete] = useState(false);
  const detailsFormRef = useRef<HTMLFormElement>(null);

  const [countryCode, setCountryCode] = useState('');
  const [nationalFederationCountryCode, setNationalFederationCountryCode] = useState('');
  const [federationWasManuallyEdited, setFederationWasManuallyEdited] = useState(false);
  const [idocRegion, setIdocRegion] = useState('');
  const [regionWasManuallyEdited, setRegionWasManuallyEdited] = useState(false);
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [address2WasManuallyEdited, setAddress2WasManuallyEdited] = useState(false);
  const [city, setCity] = useState('');
  const [stateProvince, setStateProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [autocompleteAvailable, setAutocompleteAvailable] = useState(true);
  const [selectedAddressValue, setSelectedAddressValue] = useState('');
  const [geolocationBias, setGeolocationBias] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    // A one-time, best-effort bias hint for ranking autocomplete suggestions -- without it, a
    // short/common street name matches too many places worldwide to be useful (the reported
    // complaint: address lookup "almost doesn't find the locations"). Never blocks or delays
    // typing: an unavailable API, a denied/dismissed permission prompt, or any error just leaves
    // suggestions unbiased, exactly as before this existed.
    if (step !== 'details' || typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => setGeolocationBias({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => {},
      { maximumAge: 300_000, timeout: 5000 },
    );
  }, [step]);

  useEffect(() => {
    if (step !== 'details') return;

    const syncReadiness = () => {
      const form = detailsFormRef.current;
      if (form) setDetailsComplete(isDetailsFormComplete(form, classification));
    };

    syncReadiness();
    const animationFrame = requestAnimationFrame(syncReadiness);
    const shortDelay = window.setTimeout(syncReadiness, 250);
    const autofillDelay = window.setTimeout(syncReadiness, 1000);
    window.addEventListener('pageshow', syncReadiness);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(shortDelay);
      window.clearTimeout(autofillDelay);
      window.removeEventListener('pageshow', syncReadiness);
    };
  }, [address1, city, classification, countryCode, idocRegion, nationalFederationCountryCode, postalCode, stateProvince, step]);

  useEffect(() => {
    const query = address1.trim();
    if (step !== 'details' || !countryCode || query.length < 3 || query === selectedAddressValue) {
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
  }, [address1, countryCode, geolocationBias, selectedAddressValue, step]);

  function handleCountryChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextCountryCode = event.target.value;
    setCountryCode(nextCountryCode);
    if (!nationalFederationCountryCode || !federationWasManuallyEdited) {
      setNationalFederationCountryCode(nextCountryCode);
      setFederationWasManuallyEdited(false);
    }
    if (!regionWasManuallyEdited) {
      setIdocRegion(nextCountryCode ? IDOC_REGION_BY_COUNTRY[nextCountryCode] ?? '' : '');
    }
    setAddress1('');
    setAddress2('');
    setAddress2WasManuallyEdited(false);
    setCity('');
    setStateProvince('');
    setPostalCode('');
    setSelectedAddressValue('');
    setSuggestions([]);
    setAutocompleteAvailable(true);
    setDetailsComplete(false);
  }

  function handleFederationChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextFederationCountryCode = event.target.value;
    setNationalFederationCountryCode(nextFederationCountryCode);
    setFederationWasManuallyEdited(Boolean(nextFederationCountryCode));
  }

  function handleRegionChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextRegion = event.target.value;
    setIdocRegion(nextRegion);
    setRegionWasManuallyEdited(Boolean(nextRegion));
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

  if (step === 'type') {
    return (
      <AuthShell description="Select the official capacity that best describes you. You can hold more than one." title="What kind of official are you?" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          {TYPE_OPTIONS.map((option) => (
            <button
              aria-pressed={classification === option.value}
              className={`cursor-pointer rounded-lg border p-4 text-left transition-all ${classification === option.value ? 'border-primary bg-primary/10 ring-2 ring-primary shadow-[0_0_24px_rgba(201,168,76,0.22)]' : 'border-border hover:border-input'}`}
              key={option.value}
              onClick={() => { setClassification(option.value); setDetailsComplete(false); }}
              type="button"
            >
              <div className="font-medium text-foreground">{option.label}</div>
              <div className="mt-1 text-sm text-muted-foreground">{option.description}</div>
            </button>
          ))}
        </div>
        <Button className="mt-6 w-full" disabled={!classification} onClick={() => setStep('details')} size="lg" type="button">
          Continue
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell description="All fields are required unless marked optional." title="Complete your profile" wide>
      <form
        action={action}
        className="space-y-9"
        onChange={(event) => setDetailsComplete(isDetailsFormComplete(event.currentTarget, classification))}
        onInput={(event) => setDetailsComplete(isDetailsFormComplete(event.currentTarget, classification))}
        ref={detailsFormRef}
      >
        <CsrfField />
        <input name="classification" type="hidden" value={classification ?? ''} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="firstName">First name</Label>
            <Input id="firstName" name="firstName" required />
          </div>
          <div>
            <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="lastName">Last name</Label>
            <Input id="lastName" name="lastName" required />
          </div>
        </div>

        <fieldset className="space-y-4 border-0 p-0">
          <legend className="mb-4 block w-full text-sm font-bold uppercase tracking-wider text-foreground">ADDRESS</legend>
          <div>
            <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="countryCode">Country</Label>
            <CountrySelect id="countryCode" name="countryCode" onChange={handleCountryChange} value={countryCode} />
          </div>

          <div className="relative">
            <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="address1">Street address / Address 1</Label>
            <Input
              aria-autocomplete="list"
              aria-controls="address-suggestions"
              autoComplete="street-address"
              disabled={!countryCode}
              id="address1"
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
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg" id="address-suggestions" role="listbox">
                {suggestions.map((suggestion, index) => (
                  <button
                    className="block w-full border-b border-border px-3 py-2 text-left text-sm text-foreground last:border-0 hover:bg-surface"
                    key={`${suggestion.formatted}-${index}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseAddress(suggestion)}
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
            <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="address2">Address 2 (optional)</Label>
            <Input
              autoComplete="address-line2"
              id="address2"
              name="address2"
              onChange={(event) => {
                setAddress2(event.target.value);
                setAddress2WasManuallyEdited(true);
              }}
              value={address2}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="city">City / Locality</Label>
              <Input autoComplete="address-level2" id="city" name="city" onChange={(event) => setCity(event.target.value)} required value={city} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="stateProvince">State / Province / Region</Label>
              <Input autoComplete="address-level1" id="stateProvince" name="stateProvince" onChange={(event) => setStateProvince(event.target.value)} required value={stateProvince} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="postalCode">Postal / ZIP code</Label>
              <Input autoComplete="postal-code" id="postalCode" name="postalCode" onChange={(event) => setPostalCode(event.target.value)} required value={postalCode} />
            </div>
          </div>
        </fieldset>

        {classification !== 'veterinarian' ? (
          <fieldset className="space-y-4 border-0 p-0">
            <legend className="mb-4 block w-full text-sm font-bold uppercase tracking-wider text-foreground">OFFICIAL INFORMATION</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="nationalFederationCountryCode">National Federation</Label>
                <CountrySelect
                  id="nationalFederationCountryCode"
                  name="nationalFederationCountryCode"
                  onChange={handleFederationChange}
                  value={nationalFederationCountryCode}
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="idocRegion">IDOC Region</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm" id="idocRegion" name="idocRegion" onChange={handleRegionChange} required value={idocRegion}>
                  <option value="">Select</option>
                  {IDOC_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="feiId">FEI Number (optional)</Label>
                <Input id="feiId" name="feiId" />
              </div>
            </div>
            {classification === 'judge' || classification === 'judge_steward' ? (
              <>
                <CheckboxGroup label="Official status as Judge" name="judgeStatus" values={JUDGE_STATUSES} />
                <div>
                  <Label className="mb-1.5 block text-sm font-bold text-foreground" htmlFor="isTechnicalDelegate">Are you a Technical Delegate?</Label>
                  <select className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm sm:w-48" id="isTechnicalDelegate" name="isTechnicalDelegate">
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
              </>
            ) : null}
            {classification === 'steward' || classification === 'judge_steward' ? (
              <CheckboxGroup label="Official status as Steward" name="stewardStatus" values={STEWARD_STATUSES} />
            ) : null}
          </fieldset>
        ) : null}

        <fieldset className="space-y-3 border-0 p-0">
          <legend className="mb-4 block w-full text-sm font-bold uppercase tracking-wider text-foreground">CONSENT</legend>
          <ConsentCheckbox name="termsAccepted" required>
            {' '}I have read and agree to the <a className="text-primary underline underline-offset-4 hover:opacity-80" href="/terms" target="_blank">Terms Of Service</a> and I acknowledge that I am signing up for a recurring membership fee that will be automatically charged to this card every year (until I specifically ask to terminate my account in time).
          </ConsentCheckbox>
          <ConsentCheckbox name="privacyAccepted" required>
            {' '}This site collects names, emails and other user information. I consent to the terms set forth in the <a className="text-primary underline underline-offset-4 hover:opacity-80" href="/privacy" target="_blank">Privacy Policy</a>.
          </ConsentCheckbox>
          <ConsentCheckbox defaultChecked name="keepUpdated">
            {' '}Keep me updated on IDOC events, workshops, and certifications.
          </ConsentCheckbox>
        </fieldset>

        {state.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
        <div className="flex items-center gap-3">
          <button className="cursor-pointer text-sm text-muted-foreground underline" onClick={() => { setDetailsComplete(false); setStep('type'); }} type="button">Back</button>
          <Button className="flex-1" disabled={pending || !detailsComplete} size="lg" type="submit">
            {pending ? 'Saving…' : 'Continue to payment'}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}

function CountrySelect({
  id,
  name,
  onChange,
  value,
}: {
  id: string;
  name: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  value?: string;
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm"
      id={id}
      name={name}
      onChange={onChange}
      required
      value={value}
    >
      <option value="">Select country</option>
      {COUNTRY_OPTIONS.map(({ code, name: countryName }) => <option key={code} value={code}>{countryName}</option>)}
    </select>
  );
}

function CheckboxGroup({ label, name, values }: { label: string; name: string; values: readonly string[] }) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-bold text-foreground">{label}</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {values.map((value) => (
          <label className="flex items-center gap-2 text-sm text-foreground" key={value}>
            <input name={name} type="checkbox" value={value} />
            {value}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ConsentCheckbox({ children, defaultChecked, name, required = false }: { children: ReactNode; defaultChecked?: boolean; name: string; required?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm text-foreground">
      <input defaultChecked={defaultChecked} className="mt-0.5" name={name} required={required} type="checkbox" />
      <span>{children}</span>
    </label>
  );
}
