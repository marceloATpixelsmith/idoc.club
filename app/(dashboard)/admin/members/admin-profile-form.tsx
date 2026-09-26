'use client';

import { useActionState, useState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { saveMemberProfileByAdminForm } from './actions';
import { IDOC_REGIONS, ISO_COUNTRY_CODES, JUDGE_STATUSES, STEWARD_STATUSES } from '@/lib/membership/validation';

type Role = { feiId: string | null; idocRegion: string | null; isTechnicalDelegate: boolean | null; nationalFederationCountryCode: string | null; officialStatuses: string[] | null; roleType: string };
type Member = { profile: Record<string, unknown>; roles: Role[] };
// Matches lib/db/schema.ts's profiles column lengths (memberProfileSchema enforces the same limits
// server-side; this is the client-side half of the same requirement).
const FIELD_MAX_LENGTH: Record<string, number> = {
  address1: 200, address2: 200, city: 100, firstName: 100, lastName: 100, postalCode: 30, stateProvince: 100,
};
const SELECT_CLASSNAME = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

export function AdminProfileForm({ member, profileId }: { member: Member; profileId: number }) {
  const judge = member.roles.find((role) => role.roleType === 'judge');
  const steward = member.roles.find((role) => role.roleType === 'steward');
  const initial = judge && steward ? 'judge_steward' : (judge?.roleType ?? steward?.roleType ?? 'veterinarian');
  const [classification, setClassification] = useState(initial);
  const [state, action, pending] = useActionState(saveMemberProfileByAdminForm, {} as { error?: string; success?: string });
  const official = judge ?? steward;
  return <form action={action} className="space-y-4">
    <CsrfField />
    <input type="hidden" name="profileId" value={profileId} />
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">Basic information</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <Field label="First Name" maxLength={FIELD_MAX_LENGTH.firstName} name="firstName" required value={String(member.profile.firstName ?? '')} />
          <Field label="Last Name" maxLength={FIELD_MAX_LENGTH.lastName} name="lastName" required value={String(member.profile.lastName ?? '')} />
          <Field className="col-span-2" label="Address 1" maxLength={FIELD_MAX_LENGTH.address1} name="address1" required value={String(member.profile.address1 ?? '')} />
          <Field className="col-span-2" label="Address 2 (optional)" maxLength={FIELD_MAX_LENGTH.address2} name="address2" value={String(member.profile.address2 ?? '')} />
          <Field label="City" maxLength={FIELD_MAX_LENGTH.city} name="city" required value={String(member.profile.city ?? '')} />
          <Field label="State/Province" maxLength={FIELD_MAX_LENGTH.stateProvince} name="stateProvince" required value={String(member.profile.stateProvince ?? '')} />
          <Field label="ZIP/postal code" maxLength={FIELD_MAX_LENGTH.postalCode} name="postalCode" required value={String(member.profile.postalCode ?? '')} />
          <Select id="countryCode" initial={String(member.profile.countryCode)} label="Country" name="countryCode" required values={ISO_COUNTRY_CODES} />
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="classification">Professional classification</Label>
            <select className={SELECT_CLASSNAME} id="classification" name="classification" onChange={(event) => setClassification(event.target.value)} value={classification}>
              <option value="judge">Judge</option>
              <option value="steward">Steward</option>
              <option value="judge_steward">Judge + Steward</option>
              <option value="veterinarian">Veterinarian</option>
            </select>
          </div>
        </CardContent>
      </Card>
      {classification !== 'veterinarian' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">Official information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Select id="nationalFederationCountryCode" initial={official?.nationalFederationCountryCode ?? ''} label="National Federation" name="nationalFederationCountryCode" required values={ISO_COUNTRY_CODES} />
            <Select id="idocRegion" initial={official?.idocRegion ?? ''} label="IDOC Region" name="idocRegion" required values={IDOC_REGIONS} />
            <Field className="col-span-2" label="FEI ID (optional)" name="feiId" value={official?.feiId ?? ''} />
            {(classification === 'judge' || classification === 'judge_steward') && (
              <div className="col-span-2 grid grid-cols-2 gap-4">
                <CheckboxGroup initial={judge?.officialStatuses ?? []} label="Official Status as Judge" name="judgeStatus" values={JUDGE_STATUSES} />
                <Select id="isTechnicalDelegate" initial={judge?.isTechnicalDelegate ? 'yes' : 'no'} label="Technical Delegate" name="isTechnicalDelegate" required values={['yes', 'no']} />
              </div>
            )}
            {(classification === 'steward' || classification === 'judge_steward') && (
              <div className="col-span-2">
                <CheckboxGroup initial={steward?.officialStatuses ?? []} label="Official Status as Steward" name="stewardStatus" values={STEWARD_STATUSES} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="admin-profile-reason">Administrative reason (required)</Label>
      <Textarea id="admin-profile-reason" name="reason" required rows={2} />
    </div>
    {state.error ? <p className="text-red-400">{state.error}</p> : null}
    {state.success ? <p className="text-green-400">{state.success}</p> : null}
    <Button disabled={pending} type="submit">Save correction</Button>
  </form>;
}

function Field({ className, label, maxLength, name, required, value }: { className?: string; label: string; maxLength?: number; name: string; required?: boolean; value: string }) {
  return <div className={cnField(className)}>
    <Label htmlFor={name}>{label}</Label>
    <Input defaultValue={value} id={name} maxLength={maxLength} name={name} required={required} />
  </div>;
}

function cnField(className?: string) {
  return className ? `space-y-1.5 ${className}` : 'space-y-1.5';
}

function Select({ id, initial, label, name, required, values }: { id: string; initial: string; label: string; name: string; required: boolean; values: readonly string[] }) {
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <select className={SELECT_CLASSNAME} defaultValue={initial} id={id} name={name} required={required}>
      <option value="">Select</option>
      {values.map((value) => <option key={value} value={value}>{value}</option>)}
    </select>
  </div>;
}

function CheckboxGroup({ initial, label, name, values }: { initial: string[]; label: string; name: string; values: readonly string[] }) {
  return <fieldset className="space-y-2">
    <legend className="text-sm font-medium text-foreground">{label}</legend>
    {values.map((value) => (
      <Label className="flex items-center gap-2 font-normal" key={value}>
        <Checkbox defaultChecked={initial.includes(value)} name={name} value={value} />
        {value}
      </Label>
    ))}
  </fieldset>;
}
