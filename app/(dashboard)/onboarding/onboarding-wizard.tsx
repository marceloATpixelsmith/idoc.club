'use client';

import { useActionState, useState } from 'react';
import type { ReactNode } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IDOC_REGIONS, ISO_COUNTRY_CODES, JUDGE_STATUSES, STEWARD_STATUSES } from '@/lib/membership/validation';
import { completeOnboarding } from './actions';

type Classification = 'judge' | 'judge_steward' | 'steward' | 'veterinarian';

const TYPE_OPTIONS: { value: Classification; label: string; description: string }[] = [
  { value: 'judge', label: 'Judge', description: 'Officiate dressage competitions as a licensed judge.' },
  { value: 'steward', label: 'Steward', description: 'Oversee competition rules and welfare on the ground.' },
  { value: 'judge_steward', label: 'Judge + Steward', description: 'Hold both official capacities.' },
  { value: 'veterinarian', label: 'Veterinarian', description: 'Provide veterinary oversight at competitions.' },
];

const fields = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['address1', 'Address 1'],
  ['address2', 'Address 2 (optional)'], ['city', 'City'], ['stateProvince', 'State/Province'],
  ['postalCode', 'ZIP/postal code'],
] as const;

export function OnboardingWizard() {
  const [state, action, pending] = useActionState<{ error?: string }, FormData>(completeOnboarding, {});
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [classification, setClassification] = useState<Classification | null>(null);

  if (step === 'type') {
    return (
      <AuthShell description="Select the official capacity that best describes you. You can hold more than one." title="What kind of official are you?" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          {TYPE_OPTIONS.map((option) => (
            <button
              className={`cursor-pointer rounded-lg border p-4 text-left transition-colors ${classification === option.value ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'}`}
              key={option.value} onClick={() => setClassification(option.value)} type="button"
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
      <form action={action} className="space-y-5">
        <input name="classification" type="hidden" value={classification ?? ''} />
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(([name, label]) => (
            <div className={name === 'address1' || name === 'address2' ? 'sm:col-span-2' : ''} key={name}>
              <Label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor={name}>{label}</Label>
              <Input id={name} name={name} required={name !== 'address2'} />
            </div>
          ))}
          <div>
            <Label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="countryCode">Country</Label>
            <CountrySelect id="countryCode" name="countryCode" />
          </div>
        </div>

        {classification !== 'veterinarian' ? (
          <fieldset className="space-y-4 rounded-lg border border-gray-200 p-4">
            <legend className="px-1 text-sm font-medium text-gray-700">Official information</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="nationalFederationCountryCode">National Federation</Label>
                <CountrySelect id="nationalFederationCountryCode" name="nationalFederationCountryCode" />
              </div>
              <div>
                <Label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="idocRegion">IDOC Region</Label>
                <select className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm" id="idocRegion" name="idocRegion" required>
                  <option value="">Select</option>
                  {IDOC_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="feiId">FEI ID</Label>
                <Input id="feiId" name="feiId" required />
              </div>
            </div>
            {classification === 'judge' || classification === 'judge_steward' ? (
              <>
                <CheckboxGroup label="Official status as Judge" name="judgeStatus" values={JUDGE_STATUSES} />
                <div>
                  <Label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="isTechnicalDelegate">Are you a Technical Delegate?</Label>
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
          <legend className="px-1 text-sm font-medium text-gray-700">Consent</legend>
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
          <button className="cursor-pointer text-sm text-gray-600 underline" onClick={() => setStep('type')} type="button">Back</button>
          <Button className="flex-1" disabled={pending} size="lg" type="submit">
            {pending ? 'Saving…' : 'Create profile'}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}

function CountrySelect({ id, name }: { id: string; name: string }) {
  return (
    <select className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm" id={id} name={name} required>
      <option value="">Select</option>
      {ISO_COUNTRY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
    </select>
  );
}

function CheckboxGroup({ label, name, values }: { label: string; name: string; values: readonly string[] }) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-gray-700">{label}</legend>
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
