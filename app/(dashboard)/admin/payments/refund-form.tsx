'use client';

import { useEffect, useState } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { DialogClose } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { refundMembershipPaymentForm } from './actions';

export function MembershipRefundForm({ onSuccess, paymentId, profileId }: { onSuccess?: () => void; paymentId: string; profileId: string }) {
  const [reason, setReason] = useState('');
  const [state, action, pending, dialog] = useFreshStepUpAction(refundMembershipPaymentForm, {});
  useEffect(() => { if (state.success) onSuccess?.(); }, [state.success, onSuccess]);
  return <><form action={action} className="space-y-2"><CsrfField /><input name="paymentId" type="hidden" value={paymentId} /><input name="profileId" type="hidden" value={profileId} />
    <label className="block text-sm font-medium" htmlFor={`refund-reason-${paymentId}`}>Refund reason</label>
    <Textarea id={`refund-reason-${paymentId}`} onChange={(event) => setReason(event.target.value)} value={reason} aria-label="Administrative refund reason" maxLength={1000} minLength={5} name="reason" placeholder="Approved policy reason" required rows={2} />
    {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}{state.success ? <p className="text-sm text-green-700" role="status">{state.success}</p> : null}
    <div className="flex flex-wrap justify-end gap-2"><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
    <Button disabled={pending} type="submit" variant="destructive">{pending ? <AuthPendingLabel text="Refunding" /> : 'Approve full refund'}</Button></div>
  </form>{dialog}</>;
}
