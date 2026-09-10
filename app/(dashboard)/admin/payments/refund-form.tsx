'use client';

import { AuthPendingLabel } from '@/components/auth/pending-label';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { refundMembershipPaymentForm } from './actions';

export function MembershipRefundForm({ paymentId, profileId }: { paymentId: string; profileId: string }) {
  const [state, action, pending, dialog] = useFreshStepUpAction(refundMembershipPaymentForm, {});
  return <><form action={action} className="space-y-2"><CsrfField /><input name="paymentId" type="hidden" value={paymentId} /><input name="profileId" type="hidden" value={profileId} />
    <textarea aria-label="Administrative refund reason" className="w-full border p-2 text-sm" maxLength={1000} minLength={5} name="reason" placeholder="Approved policy reason" required />
    {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}{state.success ? <p className="text-sm text-green-700" role="status">{state.success}</p> : null}
    <Button disabled={pending} type="submit" variant="destructive">{pending ? <AuthPendingLabel text="Refunding" /> : 'Approve full refund'}</Button>
  </form>{dialog}</>;
}
