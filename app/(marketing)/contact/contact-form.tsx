'use client';

import { useActionState, useEffect, useState } from 'react';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/auth/middleware';
import { submitContactForm } from './actions';

export function ContactForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(submitContactForm, {});
  const [turnstileToken, setTurnstileToken] = useState('');
  // Every submission attempt consumes its Turnstile token server-side whether or not it ultimately
  // succeeds (e.g. a caught Brevo delivery failure after verification passed) -- retrying with the
  // same already-spent token would just fail verification again with no way out short of a page
  // reload. Remounting the widget (via the key below) forces a fresh challenge/token on every
  // failed attempt.
  const [turnstileAttempt, setTurnstileAttempt] = useState(0);

  useEffect(() => {
    if (state.error) {
      setTurnstileToken('');
      setTurnstileAttempt((attempt) => attempt + 1);
    }
  }, [state]);

  if (state.success) {
    return (
      <p className="rounded-lg border border-border bg-surface/40 p-5 text-sm text-muted-foreground" role="status">
        {state.success}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <CsrfField />
      <input name="turnstileToken" type="hidden" value={turnstileToken} />
      <div className="space-y-1.5">
        <Label htmlFor="contact-name">Name</Label>
        <Input id="contact-name" name="name" required autoComplete="name" maxLength={200} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-email">Email</Label>
        <Input id="contact-email" name="email" type="email" required autoComplete="email" maxLength={255} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-subject">Subject</Label>
        <Input id="contact-subject" name="subject" required maxLength={200} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-message">Message</Label>
        <Textarea id="contact-message" name="message" required maxLength={5000} rows={6} />
      </div>
      <TurnstileWidget key={turnstileAttempt} action="contact" onVerify={setTurnstileToken} />
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button disabled={pending || !turnstileToken} type="submit">
        {pending ? <AuthPendingLabel text="Sending" /> : 'Send message'}
      </Button>
    </form>
  );
}
