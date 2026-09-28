'use client';

import { useActionState, useEffect, useState } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { registerAsGuestForSeminarAction, type GuestSeminarState } from '@/app/(marketing)/seminars/actions';

/** The one anonymous, no-account write path on the public seminars page -- gated by Turnstile and a
 * rate limit (see registerAsGuestForSeminarAction) the same way the public contact form is, since it
 * is the only other unauthenticated form in this app. Kept separate from the generic SeminarForm
 * wrapper (which every authenticated seminar form uses) because only this one needs a Turnstile
 * challenge token lifted into state to gate its own submit button. */
export function GuestRegistrationForm({ paymentMethods, seminarId }: {
  paymentMethods: Array<{ canonical_id: unknown; display_label: unknown }>; seminarId: number;
}) {
  const [state, formAction, pending] = useActionState<GuestSeminarState, FormData>(registerAsGuestForSeminarAction, {});
  const [turnstileToken, setTurnstileToken] = useState('');
  // A submitted token is consumed server-side whether or not the attempt ultimately succeeds --
  // remount the widget on every failed attempt so retrying gets a fresh one (mirrors ContactForm).
  const [turnstileAttempt, setTurnstileAttempt] = useState(0);

  useEffect(() => {
    if (state.error) {
      setTurnstileToken('');
      setTurnstileAttempt((attempt) => attempt + 1);
    }
  }, [state]);

  if (state.success) return <p className="text-sm text-green-700" role="status">{state.success}</p>;

  return (
    <form action={formAction} className="space-y-3">
      <CsrfField />
      <input name="seminarId" type="hidden" value={seminarId} />
      <input name="turnstileToken" type="hidden" value={turnstileToken} />
      <label className="block text-sm">Full name<input className="mt-1 block w-full rounded-md border border-input bg-transparent p-2 text-sm" maxLength={200} name="name" required /></label>
      <label className="block text-sm">Email<input className="mt-1 block w-full rounded-md border border-input bg-transparent p-2 text-sm" maxLength={255} name="email" required type="email" /></label>
      <label className="block text-sm">Payment method
        <select className="mt-1 block w-full rounded-md border border-input bg-transparent p-2 text-sm" name="paymentMethod" required>
          {paymentMethods.map((method) => <option key={String(method.canonical_id)} value={String(method.canonical_id)}>{String(method.display_label)}</option>)}
        </select>
      </label>
      <TurnstileWidget action="seminar_guest_registration" key={turnstileAttempt} onVerify={setTurnstileToken} theme="dark" />
      {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
      <Button disabled={pending || !turnstileToken} type="submit">{pending ? <AuthPendingLabel text="Registering" /> : 'Register as guest'}</Button>
    </form>
  );
}
