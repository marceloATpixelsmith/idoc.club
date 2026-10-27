'use client';

import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { useActionState, useEffect, useRef, useState, useTransition, type RefObject } from 'react';
import { cancelStepUp, verifyStepUpTotp } from '@/app/(login)/mfa/actions';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

export type StepUpActionState = { error?: string; stepUpRequired?: boolean; success?: string; retryAfterSeconds?: number; [key: string]: unknown };
type Action<T extends StepUpActionState = StepUpActionState> = (state: T, formData: FormData) => Promise<T>;

/** Runs a protected Server Action, retaining its FormData only in this component's memory. After
 * TOTP succeeds the exact same authoritative action is invoked automatically; its normal
 * authorization, CSRF, validation, and single-use fresh-authority checks all run again. */
export function useFreshStepUpAction<T extends StepUpActionState>(action: Action<T>, initialState: T) {
  const [state, setState] = useState<T>(initialState);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeId, setChallengeId] = useState(0);
  const [challengeMethod, setChallengeMethod] = useState<'totp' | 'email'>('totp');
  const [pending, startTransition] = useTransition();
  const submitted = useRef<FormData | null>(null);

  const run = (formData: FormData) => {
    if (pending || challengeOpen) return;
    submitted.current = formData;
    startTransition(async () => {
      const result = await action(state, formData);
      if (result.stepUpRequired) {
        setChallengeMethod(result.stepUpMethod === 'email' ? 'email' : 'totp');
        setChallengeId((id) => id + 1);
        setChallengeOpen(true);
        setState({} as T);
      } else {
        submitted.current = null;
        setState(result);
      }
    });
  };

  // Mounted only while a challenge is open, and keyed per challenge: the dialog keeps the previous verification's result in its own
  // state, so a dialog that stayed mounted would treat the next challenge as already verified and disable itself.
  const challenge = challengeOpen
    ? challengeMethod === 'email'
      ? <MemberEmailSecurityDialog action={action as unknown as Action} formDataRef={submitted} key={challengeId}
        onResult={(result) => setState(result as T)} onOpenChange={(open) => { setChallengeOpen(open); if (!open) submitted.current = null; }} open />
      : <FreshStepUpDialog action={action as unknown as Action} formDataRef={submitted} key={challengeId} onResult={(result) => setState(result as T)}
        onOpenChange={(open) => { setChallengeOpen(open); if (!open) submitted.current = null; }} open />
    : null;
  return [state, run, pending || challengeOpen, challenge] as const;
}

function FreshStepUpDialog({ action, formDataRef, onOpenChange, onResult, open }: {
  action: Action; formDataRef: RefObject<FormData | null>; onOpenChange: (open: boolean) => void;
  onResult: (state: StepUpActionState) => void; open: boolean;
}) {
  const [code, setCode] = useState('');
  const [state, verify, verifying] = useActionState<StepUpActionState, FormData>(verifyStepUpTotp, {});
  const [retrySeconds, setRetrySeconds] = useState(0);
  useEffect(() => {
    setRetrySeconds(Math.max(0, Math.ceil(state.retryAfterSeconds ?? 0)));
  }, [state.retryAfterSeconds]);
  useEffect(() => {
    if (retrySeconds === 0) return;
    const interval = window.setInterval(() => setRetrySeconds((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(interval);
  }, [retrySeconds]);
  const [cancelState, cancel, cancelling] = useActionState<StepUpActionState, FormData>(cancelStepUp, {});
  const [resuming, startResume] = useTransition();
  const resumeStarted = useRef(false);
  const cancellationHandled = useRef(false);
  const cancelForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) {
      resumeStarted.current = false;
      cancellationHandled.current = false;
      setCode('');
    }
  }, [open]);

  useEffect(() => {
    if (!state.verified || !formDataRef.current || resumeStarted.current) return;
    resumeStarted.current = true;
    const original = formDataRef.current;
    startResume(async () => {
      const result = await action({}, original);
      formDataRef.current = null;
      onResult(result.stepUpRequired
        ? { error: 'Verification could not be applied safely. Please restart the action.' }
        : result);
      onOpenChange(false);
    });
  }, [action, formDataRef, onOpenChange, onResult, state.verified]);

  useEffect(() => {
    if (!cancelState.cancelled || cancellationHandled.current) return;
    cancellationHandled.current = true;
    onResult({ error: 'Verification was cancelled. Restart the action when you are ready.' });
    onOpenChange(false);
  }, [cancelState.cancelled, onOpenChange, onResult]);

  const busy = verifying || resuming || cancelling;
  // The persisted challenge expires after five minutes, so a rate-limited challenge must
  // be restarted rather than reusing stale authority after a longer cooldown.
  const restartRequired = typeof state.retryAfterSeconds === 'number';
  // Escape (or clicking away) cancels exactly like the Cancel button, so the dialog can never trap anyone; it is ignored only while a
  // verification or the resumed action is already in flight.
  return <Dialog onOpenChange={(next) => { if (!next && !busy) cancelForm.current?.requestSubmit(); }} open={open}>
    <DialogContent aria-describedby="fresh-step-up-description" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Authenticator verification required</DialogTitle>
        <DialogDescription id="fresh-step-up-description">Enter your 6-digit authenticator code. Your original action will continue automatically after verification.</DialogDescription>
      </DialogHeader>
      <form action={verify} className="space-y-4">
        <CsrfField />
        <InputOTP aria-label="Authenticator code" autoComplete="one-time-code" disabled={busy || restartRequired} maxLength={6}
          name="code" onChange={setCode} pattern={REGEXP_ONLY_DIGITS} required value={code}>
          <InputOTPGroup className="grid w-full grid-cols-6 gap-2">
            {[0, 1, 2, 3, 4, 5].map((index) => <InputOTPSlot index={index} key={index} />)}
          </InputOTPGroup>
        </InputOTP>
        {state.error ? <p className="text-sm text-red-400" role="alert">{state.error}{retrySeconds > 0 ? ` Restart available in ${Math.floor(retrySeconds / 60)}:${String(retrySeconds % 60).padStart(2, '0')}.` : restartRequired ? ' The cooldown has ended. Restart the original action for a new verification challenge.' : null}</p> : null}
        <Button className="w-full" disabled={busy || restartRequired} type="submit">{resuming ? 'Completing original action…' : verifying ? 'Verifying…' : 'Verify and continue'}</Button>
      </form>
      <form action={cancel} ref={cancelForm}><CsrfField /><Button className="w-full" disabled={busy} type="submit" variant="outline">{restartRequired && retrySeconds === 0 ? 'Restart original action' : 'Cancel'}</Button></form>
    </DialogContent>
  </Dialog>;
}

/** The email code is given only to the original server action. It is not exchanged for a
 * reusable authority cookie, so DB verification consumes it exactly when the mutation runs. */
function MemberEmailSecurityDialog({ action, formDataRef, onOpenChange, onResult, open }: {
  action: Action; formDataRef: RefObject<FormData | null>; onOpenChange: (open: boolean) => void;
  onResult: (state: StepUpActionState) => void; open: boolean;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, start] = useTransition();
  const submit = () => {
    const original = formDataRef.current;
    if (!original || busy || !/^\\d{6}$/.test(code)) return;
    const attempt = new FormData();
    original.forEach((value, key) => attempt.append(key, value));
    attempt.set('memberSecurityCode', code);
    start(async () => {
      try {
        const result = await action({}, attempt);
        if (result.stepUpRequired && result.stepUpMethod === 'email') {
          setError(result.error ?? 'That code could not be verified. Try again or restart the action.');
          return;
        }
        formDataRef.current = null;
        onResult(result);
        onOpenChange(false);
      } catch {
        setError('Verification failed. Please try again.');
      }
    });
  };
  return <Dialog onOpenChange={(next) => { if (!next && !busy) onOpenChange(false); }} open={open}>
    <DialogContent aria-describedby="member-step-up-description">
      <DialogHeader>
        <DialogTitle>Confirm this security change</DialogTitle>
        <DialogDescription id="member-step-up-description">We emailed you a 6-digit code. Enter it to confirm this action. The code expires after 15 minutes and can only be used once.</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="space-y-4">
        <InputOTP aria-label="Email security code" autoComplete="one-time-code" disabled={busy} maxLength={6}
          onChange={setCode} pattern={REGEXP_ONLY_DIGITS} required value={code}>
          <InputOTPGroup className="grid w-full grid-cols-6 gap-2">
            {[0, 1, 2, 3, 4, 5].map((index) => <InputOTPSlot index={index} key={index} />)}
          </InputOTPGroup>
        </InputOTP>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <Button className="w-full" disabled={busy || code.length !== 6} type="submit">{busy ? 'Verifying…' : 'Verify and continue'}</Button>
      </form>
      <Button className="w-full" disabled={busy} onClick={() => { onResult({ error: 'Verification cancelled.' }); onOpenChange(false); }} variant="outline">Cancel</Button>
    </DialogContent>
  </Dialog>;
}
