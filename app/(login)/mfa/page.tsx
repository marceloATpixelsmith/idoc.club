'use client';

import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { useActionState, useEffect, useRef, useState, useTransition, type RefObject } from 'react';
import { cancelStepUp, verifyStepUpTotp } from '@/app/(login)/mfa/actions';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

export type StepUpActionState = { error?: string; stepUpRequired?: boolean; success?: string; [key: string]: unknown };
type Action<T extends StepUpActionState = StepUpActionState> = (state: T, formData: FormData) => Promise<T>;

/** Runs a protected Server Action, retaining its FormData only in this component's memory. After
 * TOTP succeeds the exact same authoritative action is invoked automatically; its normal
 * authorization, CSRF, validation, and single-use fresh-authority checks all run again. */
export function useFreshStepUpAction<T extends StepUpActionState>(action: Action<T>, initialState: T) {
  const [state, setState] = useState<T>(initialState);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const submitted = useRef<FormData | null>(null);

  const run = (formData: FormData) => {
    if (pending || challengeOpen) return;
    submitted.current = formData;
    startTransition(async () => {
      const result = await action(state, formData);
      if (result.stepUpRequired) {
        setChallengeOpen(true);
        setState({} as T);
      } else {
        submitted.current = null;
        setState(result);
      }
    });
  };

  const challenge = <FreshStepUpDialog action={action as unknown as Action} formDataRef={submitted} onResult={(result) => setState(result as T)}
    onOpenChange={(open) => { setChallengeOpen(open); if (!open) submitted.current = null; }} open={challengeOpen} />;
  return [state, run, pending || challengeOpen, challenge] as const;
}

function FreshStepUpDialog({ action, formDataRef, onOpenChange, onResult, open }: {
  action: Action; formDataRef: RefObject<FormData | null>; onOpenChange: (open: boolean) => void;
  onResult: (state: StepUpActionState) => void; open: boolean;
}) {
  const [code, setCode] = useState('');
  const [state, verify, verifying] = useActionState<StepUpActionState, FormData>(verifyStepUpTotp, {});
  const [cancelState, cancel, cancelling] = useActionState<StepUpActionState, FormData>(cancelStepUp, {});
  const [resuming, startResume] = useTransition();
  const resumeStarted = useRef(false);
  const cancellationHandled = useRef(false);

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
  return <Dialog open={open}>
    <DialogContent aria-describedby="fresh-step-up-description" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Authenticator verification required</DialogTitle>
        <DialogDescription id="fresh-step-up-description">Enter your 6-digit authenticator code. Your original action will continue automatically after verification.</DialogDescription>
      </DialogHeader>
      <form action={verify} className="space-y-4">
        <CsrfField />
        <InputOTP aria-label="Authenticator code" autoComplete="one-time-code" disabled={busy} maxLength={6}
          name="code" onChange={setCode} pattern={REGEXP_ONLY_DIGITS} required value={code}>
          <InputOTPGroup className="grid w-full grid-cols-6 gap-2">
            {[0, 1, 2, 3, 4, 5].map((index) => <InputOTPSlot index={index} key={index} />)}
          </InputOTPGroup>
        </InputOTP>
        {state.error ? <p className="text-sm text-red-400" role="alert">{state.error}</p> : null}
        <Button className="w-full" disabled={busy} type="submit">{resuming ? 'Completing original action…' : verifying ? 'Verifying…' : 'Verify and continue'}</Button>
      </form>
      <form action={cancel}><CsrfField /><Button className="w-full" disabled={busy} type="submit" variant="outline">Cancel</Button></form>
    </DialogContent>
  </Dialog>;
}
