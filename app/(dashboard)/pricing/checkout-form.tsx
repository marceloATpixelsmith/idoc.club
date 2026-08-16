'use client';

import { useActionState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { checkoutAction } from '@/lib/payments/actions';

type ActionState = { error?: string };

export function CheckoutForm({ mode, label }: { label: string; mode: 'payment' | 'subscription' }) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(checkoutAction, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="mode" value={mode} />
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
      {state.error && <p className="text-red-500 text-sm mt-2">{state.error}</p>}
    </form>
  );
}
