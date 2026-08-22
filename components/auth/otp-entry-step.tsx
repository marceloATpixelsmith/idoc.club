'use client';

import { REGEXP_ONLY_DIGITS } from 'input-otp';
import type { ReactNode } from 'react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import type { ActionState } from '@/lib/auth/middleware';

const RESEND_COOLDOWN_SECONDS = 30;

type OtpAction = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

/** Shared 6-digit code entry step reused by signup, login (legacy-member activation), and password
 * reset: identical UI and behavior (paste support and numeric-only validation via InputOTP,
 * auto-submit on completion, an explicit Verify button as the no-JS/no-auto-submit fallback, a
 * 30-second resend countdown, a cancel link) across all three flows. What differs between them is
 * purely which Server Actions are wired in and what they do server-side (each is bound to a
 * distinct OTP purpose — see lib/auth/email-otp.ts), plus the copy shown above the code fields. */
export function OtpEntryStep({
  cancelAction, cancelLabel = 'Use a different email address', description, resendAction, title = 'Verify your email', verifyAction,
}: {
  cancelAction: OtpAction;
  cancelLabel?: string;
  description: ReactNode;
  resendAction: OtpAction;
  title?: string;
  verifyAction: OtpAction;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(verifyAction, { error: '' });
  const [resendState, resendFormAction, resendPending] = useActionState<ActionState, FormData>(resendAction, { error: '' });
  const [, cancelFormAction] = useActionState<ActionState, FormData>(cancelAction, { error: '' });
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_SECONDS);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  useEffect(() => {
    if (resendState.success) setSecondsLeft(RESEND_COOLDOWN_SECONDS);
  }, [resendState.success]);

  return (
    <AuthShell description={description} title={title}>
      <form action={formAction} className="space-y-4" ref={formRef}>
        <InputOTP
          autoComplete="one-time-code"
          disabled={pending}
          maxLength={6}
          name="code"
          onChange={setCode}
          onComplete={() => formRef.current?.requestSubmit()}
          pattern={REGEXP_ONLY_DIGITS}
          required
          value={code}
        >
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((index) => <InputOTPSlot index={index} key={index} />)}
          </InputOTPGroup>
        </InputOTP>
        {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <Button className="w-full" disabled={pending || code.length !== 6} size="lg" type="submit">
          {pending ? 'Verifying…' : 'Verify'}
        </Button>
      </form>
      <div className="mt-4 space-y-1 text-sm">
        <p className="text-gray-600">
          Didn&apos;t get the code?{' '}
          {secondsLeft > 0 ? (
            <span className="text-gray-400">Resend in 0:{secondsLeft.toString().padStart(2, '0')}</span>
          ) : (
            <form action={resendFormAction} className="inline">
              <button className="cursor-pointer font-medium text-gray-900 underline disabled:cursor-not-allowed disabled:opacity-50" disabled={resendPending} type="submit">Resend</button>
            </form>
          )}
        </p>
        {resendState.error ? <p className="text-red-600">{resendState.error}</p> : null}
        <form action={cancelFormAction}>
          <button className="cursor-pointer text-gray-600 underline" type="submit">{cancelLabel}</button>
        </form>
      </div>
    </AuthShell>
  );
}
