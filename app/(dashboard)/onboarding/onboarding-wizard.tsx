'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COUNTRY_OPTIONS } from '@/lib/membership/countries';
import { IDOC_REGIONS, JUDGE_STATUSES, STEWARD_STATUSES } from '@/lib/membership/validation';
import { completeOnboarding } from './actions';

type Classification = 'judge' | 'judge_steward' | 'steward' | 'veterinarian';

type AddressSuggestion = {
  addressLine1: string;
  city: string;
  country: string;
  countryCode: string;
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

export function OnboardingWizard() {
  const [state, action, pending] = useActionState<{ error?: string }, FormData>(completeOnboarding, {});
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [classification, setClassification] = useState<Classification | null>(null);
  const [detailsComplete, setDetailsComplete] = useState(false);
  const detailsFormRef = useRef<HTMLFormElement>(null);

  const [countryCode, setCountryCode] = useState('');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [city, setCity] = useState('');
  const [stateProvince, setStateProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [autocompleteAvailable, setAutocompleteAvailable] = useState(true);
  const [selectedAddressValue, setSelectedAddressValue] = useState('');

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
  }, [address1, city, classification, countryCode, postalCode, stateProvince, step]);

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
  }, [address1, countryCode, selectedAddressValue, step]);

  function handleCountryChange(event: ChangeEvent<HTMLSelectElement>) {
    setCountryCode(event.target.value);
    setAddress1('');
    setAddress2('');
    setCity('');
    setStateProvince('');
    setPostalCode('');
    setSelectedAddressValue('');
    setSuggestions([]);
    setAutocompleteAvailable(true);
    setDetailsComplete(false);
  }

  function chooseAddress(suggestion: AddressSuggestion) {
    const line1 = suggestion.addressLine1 || suggestion.formatted;
    setAddress1(line1);
    setSelectedAddressValue(line1);
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
              className={`cursor-pointer rounded-lg border p-4 text-left transition-colors ${classification === option.value ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'}`}
              key={option.value}
              onClick={() => { setClassification(option.value); setDetailsComplete(false); }}
              type="button"
            >
              <div className="font-medium text-gray-900">{option.label}</div>
              <div className="mt-1 text-sm text-gray-600">{option.description}</div>
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
        className="space-y-5"
        onChange={(event) => setDetailsComplete(isDetailsFormComplete(event.currentTarget, classification))}
        onInput={(event) => setDetailsComplete(isDetailsFormComplete(event.currentTarget, classification))}
        ref={detailsFormRef}
      >
        <input name="classification" type="hidden" value={classification ?? ''} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="firstName">First name</Label>
            <Input id="firstName" name="firstName" required />
          </div>
          <div>
            <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="lastName">Last name</Label>
            <Input id="lastName" name="lastName" required />
          </div>
        </div>

        <fieldset className="space-y-4 rounded-lg border border-gray-200 p-4">
          <legend className="px-1 text-sm font-bold text-gray-700">Address</legend>
          <div>
            <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="countryCode">Country</Label>
            <CountrySelect id="countryCode" name="countryCode" onChange={handleCountryChange} value={countryCode} />
          </div>

          <div className="relative">
            <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="address1">Street address / Address 1</Label>
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
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg" id="address-suggestions" role="listbox">
                {suggestions.map((suggestion, index) => (
                  <button
                    className="block w-full border-b border-gray-100 px-3 py-2 text-left text-sm text-gray-700 last:border-0 hover:bg-gray-50"
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
              <p className="mt-1 text-xs text-gray-500">
                {autocompleteAvailable ? 'Choose a suggestion to fill city, region, and postal code automatically, or enter the address manually.' : 'Address autocomplete is unavailable right now. You can still enter the address manually.'}
                {' '}<a className="underline" href="https://www.geoapify.com/" rel="noreferrer" target="_blank">Powered by Geoapify</a>
              </p>
            ) : null}
          </div>

          <div>
            <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="address2">Address 2 (optional)</Label>
            <Input autoComplete="address-line2" id="address2" name="address2" onChange={(event) => setAddress2(event.target.value)} value={address2} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="city">City / Locality</Label>
              <Input autoComplete="address-level2" id="city" name="city" onChange={(event) => setCity(event.target.value)} required value={city} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="stateProvince">State / Province / Region</Label>
              <Input autoComplete="address-level1" id="stateProvince" name="stateProvince" onChange={(event) => setStateProvince(event.target.value)} required value={stateProvince} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="postalCode">Postal / ZIP code</Label>
              <Input autoComplete="postal-code" id="postalCode" name="postalCode" onChange={(event) => setPostalCode(event.target.value)} required value={postalCode} />
            </div>
          </div>
        </fieldset>

        {classification !== 'veterinarian' ? (
          <fieldset className="space-y-4 rounded-lg border border-gray-200 p-4">
            <legend className="px-1 text-sm font-bold text-gray-700">Official information</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="nationalFederationCountryCode">National Federation</Label>
                <CountrySelect id="nationalFederationCountryCode" name="nationalFederationCountryCode" />
              </div>
              <div>
                <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="idocRegion">IDOC Region</Label>
                <select className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm" id="idocRegion" name="idocRegion" required>
                  <option value="">Select</option>
                  {IDOC_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="feiId">FEI ID</Label>
                <Input id="feiId" name="feiId" required />
              </div>
            </div>
            {classification === 'judge' || classification === 'judge_steward' ? (
              <>
                <CheckboxGroup label="Official status as Judge" name="judgeStatus" values={JUDGE_STATUSES} />
                <div>
                  <Label className="mb-1.5 block text-sm font-bold text-gray-700" htmlFor="isTechnicalDelegate">Are you a Technical Delegate?</Label>
                  <select className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm sm:w-48" id="isTechnicalDelegate" name="isTechnicalDelegate">
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

        <fieldset className="space-y-3 rounded-lg border border-gray-200 p-4">
          <legend className="px-1 text-sm font-bold text-gray-700">Consent</legend>
          <ConsentCheckbox name="termsAccepted" required>
            {' '}I have read and agree to the <a className="underline" href="/terms" target="_blank">Terms Of Service</a> and I acknowledge that I am signing up for a recurring membership fee that will be automatically charged to this card every year (until I specifically ask to terminate my account in time).
          </ConsentCheckbox>
          <ConsentCheckbox name="privacyAccepted" required>
            {' '}This site collects names, emails and other user information. I consent to the terms set forth in the <a className="underline" href="/privacy" target="_blank">Privacy Policy</a>.
          </ConsentCheckbox>
          <ConsentCheckbox defaultChecked name="keepUpdated">
            {' '}Keep me updated on IDOC events, workshops, and certifications.
          </ConsentCheckbox>
        </fieldset>

        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <div className="flex items-center gap-3">
          <button className="cursor-pointer text-sm text-gray-600 underline" onClick={() => { setDetailsComplete(false); setStep('type'); }} type="button">Back</button>
          <Button className="flex-1" disabled={pending || !detailsComplete} size="lg" type="submit">
            {pending ? 'Saving…' : 'Create profile'}
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
      className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm"
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
      <legend className="mb-1.5 block text-sm font-bold text-gray-700">{label}</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {values.map((value) => (
          <label className="flex items-center gap-2 text-sm text-gray-700" key={value}>
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
    <label className="flex items-start gap-2 text-sm text-gray-700">
      <input defaultChecked={defaultChecked} className="mt-0.5" name={name} required={required} type="checkbox" />
      <span>{children}</span>
    </label>
  );
}
