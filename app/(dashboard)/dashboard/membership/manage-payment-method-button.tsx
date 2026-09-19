'use client';

import { useEffect } from 'react';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { manageBillingAction } from '@/lib/payments/actions';

/** Same-tab redirect is correct here: this button lives on the dashboard's own My Membership page,
 * and Stripe's own return_url (set server-side in createMembershipPortalSession) brings the member
 * straight back to that same page -- there is no separate page left open elsewhere to protect a
 * popup for. */
export function ManagePaymentMethodButton() {
  const [state, submit, pending, dialog] = useFreshStepUpAction(manageBillingAction, {});
  useEffect(() => {
    if (state.redirectUrl) window.location.assign(String(state.redirectUrl));
  }, [state.redirectUrl]);
  return <>
    <form action={submit}>
      <CsrfField />
      <Button disabled={pending} type="submit">{pending ? <AuthPendingLabel text="Opening" /> : 'Update payment method'}</Button>
      {state.error ? <p className="mt-2 text-sm text-red-400" role="alert">{state.error}</p> : null}
    </form>
    {dialog}
  </>;
}
