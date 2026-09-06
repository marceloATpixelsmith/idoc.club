'use client';

import { useActionState, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CsrfField } from '@/components/security/csrf-field';
import { checkoutAction } from '@/lib/payments/actions';

type ActionState = { error?: string };

export function CheckoutForm({ label }: { label: string }) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(checkoutAction, {});
  const [autoRenew, setAutoRenew] = useState(true);

  return (
    <form action={formAction}>
      <CsrfField />
      <input type="hidden" name="mode" value={autoRenew ? 'subscription' : 'payment'} />
      <label className="mb-6 flex cursor-pointer items-start gap-3 rounded-md border border-border p-4">
        <input
          checked={autoRenew}
          className="mt-1 size-4 accent-primary"
          name="autoRenew"
          onChange={(event) => setAutoRenew(event.target.checked)}
          type="checkbox"
        />
        <span>
          <span className="block font-medium text-foreground">Renew automatically each year</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            On by default. Turn this off for a single 12-month payment with manual renewal.
          </span>
        </span>
      </label>
      <Button type="submit" disabled={isPending} variant="outline" className="w-full rounded-full">
        {isPending ? (
          <>
            <Loader2 className="animate-spin mr-2 h-4 w-4" />
            Redirecting to Stripe...
          </>
        ) : (
          <>
            {label}
            <ArrowRight className="ml-2 h-4 w-4" />
          </>
        )}
      </Button>
      {state.error && <p className="text-red-400 text-sm mt-2">{state.error}</p>}
    </form>
  );
}
