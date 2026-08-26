'use client';

import { useActionState } from 'react';
import { acknowledgeRecoveryCodes, authorizeAuthenticatorRecovery, beginAuthenticatorRecovery, cancelMfa, confirmTotpEnrollment, verifyLoginTotp } from './actions';

type State = { error?: string; recoveryCodes?: string[]; success?: string };

export function MfaForm({ mode, provisioningUri }: { mode: 'challenge' | 'enrollment' | 'recovery-entry' | 'replacement'; provisioningUri?: string }) {
  const action = mode === 'challenge' ? verifyLoginTotp : mode === 'recovery-entry' ? authorizeAuthenticatorRecovery : confirmTotpEnrollment;
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
        <button className="idoc-auth-button" disabled={pending} type="submit">{pending ? 'Checking…' : 'Continue'}</button>
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
      <button className="idoc-auth-button" disabled={pending} type="submit">{pending ? 'Verifying…' : 'Verify'}</button>
    </form>
    {mode === 'challenge' ? <form action={recover}><input name="recover" type="hidden" value="yes" />
      <button disabled={recovering} type="submit">Use a recovery code</button></form> : null}
    {mode === 'replacement' ? <form action={cancel}><input name="cancel" type="hidden" value="yes" />
      <button type="submit">Cancel and sign in again</button></form> : null}
    </>
  );
}
