'use client';

import { useActionState, useState } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import type { OrganizationAddress } from '@/lib/organization/settings';
import { saveOrganizationSettings, type OrganizationSettingsState } from './actions';

type Method = { canonicalId: string; displayLabel: string; enabled: boolean; instructionsHtml: string | null; systemProtected: boolean };
const ADDRESS_FIELDS = [['address1', 'Address Line 1'], ['address2', 'Address Line 2'], ['city', 'City'], ['stateProvince', 'State, province, or region'], ['postalCode', 'Postal code'], ['country', 'Country']] as const;

export function OrganizationSettingsForm({ address, methods }: { address: OrganizationAddress | null; methods: Method[] }) {
  const [state, action, pending] = useActionState<OrganizationSettingsState, FormData>(saveOrganizationSettings, {});
  const bank = methods.find((method) => method.canonicalId === 'bank_transfer')!;
  const cash = methods.find((method) => method.canonicalId === 'cash_event')!;
  const stripe = methods.find((method) => method.canonicalId === 'online_stripe')!;
  const [bankEnabled, setBankEnabled] = useState(bank.enabled);
  const [instructions, setInstructions] = useState(bank.instructionsHtml ?? '');
  return <form action={action} className="mt-8 max-w-3xl space-y-8">
    <CsrfField />
    <fieldset className="grid gap-4 rounded-lg border p-5 sm:grid-cols-2"><legend className="px-2 text-lg font-semibold">Organization address</legend>
      {ADDRESS_FIELDS.map(([name, label]) => <div key={name} className={name.startsWith('address') ? 'sm:col-span-2' : ''}>
        <label className="block text-sm font-medium" htmlFor={name}>{label}{name === 'address2' ? ' (optional)' : ''}</label>
        <input className="mt-1 w-full rounded-md border p-2" defaultValue={address?.[name] ?? ''} id={name} maxLength={name === 'postalCode' ? 30 : name.startsWith('address') ? 200 : 100} name={name} />
      </div>)}
    </fieldset>
    <fieldset className="space-y-6 rounded-lg border p-5"><legend className="px-2 text-lg font-semibold">Seminar payment methods</legend>
      <section><h2 className="font-medium">{stripe.displayLabel}</h2><p className="text-sm text-muted-foreground">Required system default. Always enabled and protected.</p></section>
      <section className="space-y-3"><label className="flex gap-3 font-medium"><input checked={bankEnabled} name="bankEnabled" onChange={(event) => setBankEnabled(event.target.checked)} type="checkbox" />Enable {bank.displayLabel}</label>
        <div><label className="block text-sm font-medium" id="bank-instructions-label">Bank Transfer instructions{bankEnabled ? ' (required)' : ''}</label>
          <div aria-label="Formatting controls" className="mt-1 flex gap-2" role="toolbar"><button className="rounded border px-3 py-1" onClick={() => document.execCommand('bold')} type="button"><strong>Bold</strong></button><button className="rounded border px-3 py-1 italic" onClick={() => document.execCommand('italic')} type="button">Italic</button><button className="rounded border px-3 py-1" onClick={() => document.execCommand('insertUnorderedList')} type="button">List</button></div>
          <div aria-labelledby="bank-instructions-label" className="mt-2 min-h-32 rounded-md border p-3" contentEditable onInput={(event) => setInstructions(event.currentTarget.innerHTML)} role="textbox" suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: bank.instructionsHtml ?? '' }} />
          <input name="bankInstructions" type="hidden" value={instructions} />
          <p className="mt-1 text-xs text-muted-foreground">Formatting is sanitized when saved. Instructions remain stored while disabled.</p></div>
      </section>
      <label className="flex gap-3 font-medium"><input defaultChecked={cash.enabled} name="cashEnabled" type="checkbox" />Enable {cash.displayLabel}</label>
    </fieldset>
    {state.error && <p aria-live="polite" className="text-sm text-red-500" role="alert">{state.error}</p>}
    {state.success && <p aria-live="polite" className="text-sm text-green-600">{state.success}</p>}
    <Button disabled={pending} type="submit">{pending ? <AuthPendingLabel text="Saving" /> : 'Save settings'}</Button>
  </form>;
}
