'use client';

import { useActionState, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import {
  acknowledgeRecoveryCodes, authorizeAuthenticatorRecovery, beginAuthenticatorRecovery, beginLoginWebAuthn,
  beginStepUpWebAuthn, cancelMfa, confirmTotpEnrollment, verifyLoginTotp, verifyLoginWebAuthn,
  verifyStepUpTotp, verifyStepUpWebAuthn,
} from './actions';

type State = { error?: string; recoveryCodes?: string[]; success?: string };
type Mode = 'challenge' | 'enrollment' | 'recovery-entry' | 'replacement' | 'step-up';

function PasskeyButton({ mode }: { mode: 'challenge' | 'step-up' }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function usePasskey() {
    setPending(true);
    setError(undefined);
    try {
      const begin = mode === 'challenge' ? await beginLoginWebAuthn() : await beginStepUpWebAuthn();
      let response;
      try {
        response = await startAuthentication({ optionsJSON: begin.options });
      } catch {
        setError('Passkey verification was cancelled or not completed.');
        return;
      }
      const formData = new FormData();
      formData.set('ceremonyId', begin.ceremonyId);
      formData.set('credentialJson', JSON.stringify(response));
      const verify = mode === 'challenge' ? verifyLoginWebAuthn : verifyStepUpWebAuthn;
      const result = await verify({}, formData);
      if (result?.error) setError(result.error);
    } catch {
      setError('That passkey could not be used. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="idoc-auth-form">
      <button disabled={pending} onClick={usePasskey} type="button">{pending ? <AuthPendingLabel text="Verifying" /> : 'Use a passkey instead'}</button>
      {error ? <p className="idoc-auth-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function MfaForm({ hasWebAuthn, mode, provisioningUri }: { hasWebAuthn?: boolean; mode: Mode; provisioningUri?: string }) {
  const action = mode === 'challenge' ? verifyLoginTotp : mode === 'step-up' ? verifyStepUpTotp : mode === 'recovery-entry' ? authorizeAuthenticatorRecovery : confirmTotpEnrollment;
  const [state, formAction, pending] = useActionState<State, FormData>(action, {});
  const [, acknowledge, acknowledging] = useActionState<State, FormData>(acknowledgeRecoveryCodes, {});
  const [, recover, recovering] = useActionState<State, FormData>(beginAuthenticatorRecovery, {});
  const [, cancel] = useActionState<State, FormData>(cancelMfa, {});
  if (state.recoveryCodes) return (
    <form action={acknowledge} className="idoc-auth-form">
      <p>Store these recovery codes somewhere safe. They will not be shown again.</p>
      <ul aria-label="Recovery codes">{state.recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
      <label><input name="saved" required type="checkbox" value="yes" /> I saved my recovery codes.</label>
      <button className="idoc-auth-button" disabled={acknowledging} type="submit">Finish sign in</button>
    </form>
  );
  if (mode === 'recovery-entry') return (
    <>
      <form action={formAction} className="idoc-auth-form">
        <label>Recovery code<input autoComplete="off" autoFocus maxLength={64} name="recoveryCode" required /></label>
        {state.error ? <p className="idoc-auth-error" role="alert">{state.error}</p> : null}
        <button className="idoc-auth-button" disabled={pending} type="submit">{pending ? <AuthPendingLabel text="Checking" /> : 'Continue'}</button>
      </form>
      <form action={cancel}><input name="cancel" type="hidden" value="yes" /><button type="submit">Cancel and sign in again</button></form>
    </>
  );
  return (
    <>
    <form action={formAction} className="idoc-auth-form">
      {(mode === 'enrollment' || mode === 'replacement') && provisioningUri ? <>
        <p>Add this account in your authenticator app, then enter its current code.</p>
        <label>Authenticator setup key<textarea readOnly rows={4} value={provisioningUri} /></label>
      </> : null}
      <label>Authenticator code<input autoComplete="one-time-code" autoFocus inputMode="numeric" maxLength={6} name="code" pattern="[0-9]{6}" required /></label>
      {state.error ? <p className="idoc-auth-error" role="alert">{state.error}</p> : null}
      <button className="idoc-auth-button" disabled={pending} type="submit">{pending ? <AuthPendingLabel text="Verifying" /> : 'Verify'}</button>
    </form>
    {(mode === 'challenge' || mode === 'step-up') && hasWebAuthn ? <PasskeyButton mode={mode} /> : null}
    {mode === 'challenge' ? <form action={recover}><input name="recover" type="hidden" value="yes" />
      <button disabled={recovering} type="submit">Use a recovery code</button></form> : null}
    {mode === 'replacement' ? <form action={cancel}><input name="cancel" type="hidden" value="yes" />
      <button type="submit">Cancel and sign in again</button></form> : null}
    </>
  );
}
