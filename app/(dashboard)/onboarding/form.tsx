'use client';

import { useActionState, useState } from 'react';
import { completeOnboarding } from './actions';
import { IDOC_REGIONS, ISO_COUNTRY_CODES, JUDGE_STATUSES, STEWARD_STATUSES } from '@/lib/membership/validation';

const fields = [['firstName', 'First Name'], ['lastName', 'Last Name'], ['address1', 'Address 1'], ['address2', 'Address 2 (optional)'], ['city', 'City'], ['stateProvince', 'State/Province'], ['postalCode', 'Zip']] as const;

export function OnboardingForm() {
  const [state, action, pending] = useActionState<{ error?: string }, FormData>(completeOnboarding, {});
  const [classification, setClassification] = useState('');
  return <form action={action} className="space-y-4">
    {fields.map(([name, label]) => <label className="block" key={name}>{label}<input className="block w-full border p-2" name={name} required={name !== 'address2'} /></label>)}
    <CountrySelect label="Country" name="countryCode" />
    <label className="block">Professional classification<select className="block w-full border p-2" name="classification" onChange={(event) => setClassification(event.target.value)} required><option value="">Select</option><option value="judge">Judge</option><option value="steward">Steward</option><option value="judge_steward">Judge + Steward</option><option value="veterinarian">Veterinarian</option></select></label>
    {classification !== 'veterinarian' && classification ? <fieldset className="space-y-4 border p-4"><legend>Official information (required for Judge and/or Steward)</legend>
      <CountrySelect label="National Federation" name="nationalFederationCountryCode" required={false} />
      <Select label="IDOC Region" name="idocRegion" values={IDOC_REGIONS} />
      <label className="block">FEI ID<input className="block w-full border p-2" name="feiId" /></label>
      {(classification === 'judge' || classification === 'judge_steward') && <><Select label="Official Status as Judge" name="judgeStatus" values={JUDGE_STATUSES} /><label className="block">Are you a Technical Delegate?<select className="block w-full border p-2" name="isTechnicalDelegate"><option value="no">No</option><option value="yes">Yes</option></select></label></>}
      {(classification === 'steward' || classification === 'judge_steward') && <Select label="Official Status as Steward" name="stewardStatus" values={STEWARD_STATUSES} />}
    </fieldset> : null}
    {state.error ? <p className="text-red-600">{state.error}</p> : null}
    <button className="rounded bg-orange-600 px-4 py-2 text-white" disabled={pending} type="submit">{pending ? 'Saving…' : 'Create profile'}</button>
  </form>;
}

function CountrySelect({ label, name, required = true }: { label: string; name: string; required?: boolean }) { return <Select label={label} name={name} required={required} values={ISO_COUNTRY_CODES} />; }
function Select({ label, name, required = false, values }: { label: string; name: string; required?: boolean; values: readonly string[] }) { return <label className="block">{label}<select className="block w-full border p-2" name={name} required={required}><option value="">Select</option>{values.map((value) => <option key={value}>{value}</option>)}</select></label>; }
