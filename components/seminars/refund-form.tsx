'use client';

import { AuthPendingLabel } from '@/components/auth/pending-label';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { refundSeminarRegistrationAction } from '@/app/(dashboard)/admin/seminars/actions';

export function SeminarRefundForm({ registrationId, seminarId }: { registrationId: string; seminarId: string }) {
  const [state, action, pending, stepUpDialog] = useFreshStepUpAction(refundSeminarRegistrationAction, {});
  return <><form action={action} className="mt-2 space-y-2"><CsrfField />
    <input name="registrationId" type="hidden" value={registrationId} /><input name="seminarId" type="hidden" value={seminarId} />
    <label className="block text-xs" htmlFor={`refund-reason-${registrationId}`}>Administrative refund reason</label>
    <textarea className="w-full border p-2 text-sm" id={`refund-reason-${registrationId}`} maxLength={1000} minLength={5} name="reason" required />
    {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
    {state.success ? <p className="text-sm text-green-700" role="status">{state.success}</p> : null}
    <Button disabled={pending} type="submit" variant="destructive">{pending ? <AuthPendingLabel text="Refunding" /> : 'Approve full refund'}</Button>
  </form>{stepUpDialog}</>;
}
