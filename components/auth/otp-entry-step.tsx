'use client';

import { REGEXP_ONLY_DIGITS } from 'input-otp';
import type { ReactNode } from 'react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { AuthShell } from '@/components/auth/auth-shell';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import type { ActionState } from '@/lib/auth/middleware';

const RESEND_COOLDOWN_SECONDS = 30;

type OtpAction = (prevState: ActionState, formData: FormData) => Promise<ActionState>;

export function OtpEntryStep({
  cancelAction,
  cancelLabel = 'Use a different email address',
  description,
  resendAction,
  title = 'Verify your email',
  verifyAction,
  verifyFields,
}: {
  cancelAction: OtpAction;
  cancelLabel?: string;
  description: ReactNode;
  resendAction: OtpAction;
  title?: string;
  verifyAction: OtpAction;
  verifyFields?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(verifyAction, { error: '' });
  const [resendState, resendFormAction, resendPending] = useActionState<ActionState, FormData>(resendAction, { error: '' });
  const [, cancelFormAction] = useActionState<ActionState, FormData>(cancelAction, { error: '' });
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_SECONDS);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = window.setTimeout(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  useEffect(() => {
    if (resendState.success) setSecondsLeft(RESEND_COOLDOWN_SECONDS);
  }, [resendState.success]);

  return (
    <AuthShell description={description} title={title}>
      <div className="idoc-auth-otp">
        <form action={formAction} className="idoc-auth-form" ref={formRef}>
          <InputOTP
            autoComplete="one-time-code"
            containerClassName="w-full"
            disabled={pending}
            maxLength={6}
            name="code"
            onChange={setCode}
            onComplete={() => {
              // When the verification step has an additional choice (for example ordinary-member
              // device trust), leave the completed code in place and let the user choose before
              // submitting instead of racing an automatic submit with the extra form control.
              if (!verifyFields) formRef.current?.requestSubmit();
            }}
            pattern={REGEXP_ONLY_DIGITS}
            required
            value={code}
          >
            <InputOTPGroup className="grid w-full grid-cols-6 gap-2">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <InputOTPSlot
                  className="h-[52px] w-full rounded-[10px] border-[1.5px] border-slate-200 bg-white text-xl font-semibold text-slate-900"
                  index={index}
                  key={index}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>

          {verifyFields}

          {state.error ? <p className="idoc-auth-error" role="alert">{state.error}</p> : null}

          <button className="idoc-auth-button" disabled={pending || code.length !== 6} type="submit">
            {pending ? <AuthPendingLabel text="Verifying" /> : 'Verify'}
          </button>
        </form>

        <div className="idoc-auth-resend" aria-live="polite">
          Didn&apos;t get the code?{' '}
          {secondsLeft > 0 ? (
            <span>Resend in {secondsLeft}s</span>
          ) : (
            <form action={resendFormAction} className="inline">
              <button disabled={resendPending} type="submit">Resend</button>
            </form>
          )}
        </div>

        {resendState.error ? <p className="idoc-auth-error" role="alert">{resendState.error}</p> : null}

        <form action={cancelFormAction} className="idoc-auth-actions__center">
          <button className="idoc-auth-link border-0 bg-transparent p-0" type="submit">{cancelLabel}</button>
        </form>
      </div>
    </AuthShell>
  );
}
