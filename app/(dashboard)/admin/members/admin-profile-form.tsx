'use client';

import { useActionState, useState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { saveMemberProfileByAdminForm } from './actions';
import { IDOC_REGIONS, ISO_COUNTRY_CODES, JUDGE_STATUSES, STEWARD_STATUSES } from '@/lib/membership/validation';

type Role = { feiId: string | null; idocRegion: string | null; isTechnicalDelegate: boolean | null; nationalFederationCountryCode: string | null; officialStatuses: string[] | null; roleType: string };
type Member = { profile: Record<string, unknown>; roles: Role[] };
const fields = [['firstName', 'First Name'], ['lastName', 'Last Name'], ['address1', 'Address 1'], ['address2', 'Address 2 (optional)'], ['city', 'City'], ['stateProvince', 'State/Province'], ['postalCode', 'ZIP/postal code']] as const;

export function AdminProfileForm({ member, profileId }: { member: Member; profileId: number }) {
  const judge = member.roles.find((role) => role.roleType === 'judge');
  const steward = member.roles.find((role) => role.roleType === 'steward');
  const initial = judge && steward ? 'judge_steward' : (judge?.roleType ?? steward?.roleType ?? 'veterinarian');
  const [classification, setClassification] = useState(initial);
  const [state, action, pending] = useActionState(saveMemberProfileByAdminForm, {} as { error?: string; success?: string });
  const official = judge ?? steward;
  return <form action={action} className="max-w-2xl space-y-4">
    <CsrfField />
    <input type="hidden" name="profileId" value={profileId} />
    {fields.map(([name, label]) => <label className="block" key={name}>{label}<input className="block w-full border p-2" defaultValue={String(member.profile[name] ?? '')} name={name} required={name !== 'address2'} /></label>)}
    <Select initial={String(member.profile.countryCode)} label="Country" name="countryCode" required values={ISO_COUNTRY_CODES} />
    <label className="block">Professional classification<select className="block w-full border p-2" name="classification" onChange={(event) => setClassification(event.target.value)} value={classification}><option value="judge">Judge</option><option value="steward">Steward</option><option value="judge_steward">Judge + Steward</option><option value="veterinarian">Veterinarian</option></select></label>
    {classification !== 'veterinarian' ? <fieldset className="space-y-4 border p-4"><legend>Official information</legend><Select initial={official?.nationalFederationCountryCode ?? ''} label="National Federation" name="nationalFederationCountryCode" required values={ISO_COUNTRY_CODES} /><Select initial={official?.idocRegion ?? ''} label="IDOC Region" name="idocRegion" required values={IDOC_REGIONS} /><label className="block">FEI ID (optional)<input className="block w-full border p-2" defaultValue={official?.feiId ?? ''} name="feiId" /></label>{classification === 'judge' || classification === 'judge_steward' ? <><CheckboxGroup initial={judge?.officialStatuses ?? []} label="Official Status as Judge" name="judgeStatus" values={JUDGE_STATUSES} /><Select initial={judge?.isTechnicalDelegate ? 'yes' : 'no'} label="Technical Delegate" name="isTechnicalDelegate" required values={['yes', 'no']} /></> : null}{classification === 'steward' || classification === 'judge_steward' ? <CheckboxGroup initial={steward?.officialStatuses ?? []} label="Official Status as Steward" name="stewardStatus" values={STEWARD_STATUSES} /> : null}</fieldset> : null}
    <label className="block">Administrative reason (required)<textarea className="block w-full border p-2" name="reason" required rows={2} /></label>
    {state.error ? <p className="text-red-600">{state.error}</p> : null}
    {state.success ? <p className="text-green-700">{state.success}</p> : null}
    <button className="rounded bg-orange-600 px-4 py-2 text-white" disabled={pending} type="submit">Save correction</button>
  </form>;
}

function Select({ initial, label, name, required, values }: { initial: string; label: string; name: string; required: boolean; values: readonly string[] }) { return <label className="block">{label}<select className="block w-full border p-2" defaultValue={initial} name={name} required={required}><option value="">Select</option>{values.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>; }

function CheckboxGroup({ initial, label, name, values }: { initial: string[]; label: string; name: string; values: readonly string[] }) { return <fieldset className="block"><legend>{label}</legend>{values.map((value) => <label className="block" key={value}><input defaultChecked={initial.includes(value)} name={name} type="checkbox" value={value} /> {value}</label>)}</fieldset>; }
