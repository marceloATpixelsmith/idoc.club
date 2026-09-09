'use client';

import { useActionState, useState } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import type { MembershipPerk } from '@/lib/organization/membership-perks';
import { saveMembershipPerks, type MembershipPerksState } from './actions';

export function MembershipPerksForm({ perks }: { perks: MembershipPerk[] }) {
  const [state, action, pending] = useActionState<MembershipPerksState, FormData>(saveMembershipPerks, {});
  const [labels, setLabels] = useState(perks.length ? perks.map((perk) => perk.label) : ['']);

  function updateLabel(index: number, value: string) {
    setLabels((current) => current.map((label, i) => (i === index ? value : label)));
  }

  function removeRow(index: number) {
    setLabels((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current));
  }

  return (
    <fieldset className="mt-8 max-w-3xl space-y-4 rounded-lg border p-5">
      <legend className="px-2 text-lg font-semibold">Membership perks</legend>
      <p className="text-sm text-muted-foreground">
        Shown on every membership-tier box on the public membership page, and on the dashboard payment box.
      </p>
      <form action={action} className="space-y-4">
        <CsrfField />
        <ol className="space-y-2">
          {labels.map((label, index) => (
            <li className="flex gap-2" key={index}>
              <input
                className="block w-full rounded-md border p-2"
                maxLength={200}
                name="perk"
                onChange={(event) => updateLabel(index, event.target.value)}
                required
                value={label}
              />
              <button
                aria-label={`Remove perk ${index + 1}`}
                className="rounded-md border px-3 text-sm disabled:opacity-50"
                disabled={labels.length <= 1}
                onClick={() => removeRow(index)}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
        <button className="rounded-md border px-3 py-2 text-sm" onClick={() => setLabels((current) => [...current, ''])} type="button">
          Add perk
        </button>
        {state.error && <p aria-live="polite" className="text-sm text-red-500" role="alert">{state.error}</p>}
        {state.success && <p aria-live="polite" className="text-sm text-green-600">{state.success}</p>}
        <Button disabled={pending} type="submit">{pending ? <AuthPendingLabel text="Saving" /> : 'Save perks'}</Button>
      </form>
    </fieldset>
  );
}
