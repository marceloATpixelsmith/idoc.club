'use client';

import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { useActionState, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { AuthPendingLabel } from '@/components/auth/pending-label';
import { CsrfField } from '@/components/security/csrf-field';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';
import {
  acknowledgeRecoveryCodes, authorizeAuthenticatorRecovery, beginAuthenticatorRecovery, beginLoginWebAuthn,
  beginStepUpWebAuthn, cancelMfa, confirmTotpEnrollment, verifyLoginTotp, verifyLoginWebAuthn,
  verifyStepUpTotp, verifyStepUpWebAuthn,
} from './actions';

type State = { error?: string; recoveryCodes?: string[]; success?: string };
type Mode = 'challenge' | 'enrollment' | 'recovery-entry' | 'replacement' | 'recovery-ack' | 'step-up';

/** `provisioningUri` (`lib/auth/mfa/totp.ts`'s `totpProvisioningUri`) is the full
 * `otpauth://totp/...?secret=...&issuer=...&algorithm=...&digits=...&period=...` URI meant for a QR
 * code -- an authenticator app's *manual entry* field only ever accepts the bare base32 `secret`
 * value, never the whole URI with its other query parameters appended. */
function totpSecretFromProvisioningUri(provisioningUri: string): string {
  try {
    return new URL(provisioningUri).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

function PasskeyButton({ mode }: { mode: 'challenge' | 'step-up' }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function usePasskey() {
    setPending(true);
    setError(undefined);
    try {
      const csrfToken = readCsrfTokenFromDocumentCookie();
      const begin = mode === 'challenge' ? await beginLoginWebAuthn(csrfToken) : await beginStepUpWebAuthn(csrfToken);
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
      formData.set('csrf_token', csrfToken);
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

export function MfaForm({ hasWebAuthn, mode, provisioningUri, qrCodeDataUrl, rememberDeviceDays, rememberDeviceEnabled }: {
  hasWebAuthn?: boolean; mode: Mode; provisioningUri?: string; qrCodeDataUrl?: string; rememberDeviceDays?: number; rememberDeviceEnabled?: boolean;
}) {
  const action = mode === 'challenge' ? verifyLoginTotp : mode === 'step-up' ? verifyStepUpTotp : mode === 'recovery-entry' ? authorizeAuthenticatorRecovery : confirmTotpEnrollment;
  const [state, formAction, pending] = useActionState<State, FormData>(action, {});
  const [code, setCode] = useState('');
  const [, acknowledge, acknowledging] = useActionState<State, FormData>(acknowledgeRecoveryCodes, {});
  const [, recover, recovering] = useActionState<State, FormData>(beginAuthenticatorRecovery, {});
  const [, cancel] = useActionState<State, FormData>(cancelMfa, {});
  const [copied, setCopied] = useState(false);

  async function copyRecoveryCodes(codes: string[]) {
    await navigator.clipboard.writeText(codes.join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (state.recoveryCodes) return (
    <form action={acknowledge} className="idoc-auth-form">
      <CsrfField />
      <p>Store these recovery codes somewhere safe. Each code can only be used once.</p>
      <div className="idoc-auth-recovery-codes">
        <div className="idoc-auth-recovery-codes__copy-row">
          <button aria-label="Copy recovery codes" className="idoc-auth-recovery-codes__copy-button"
            onClick={() => copyRecoveryCodes(state.recoveryCodes!)} title="Copy recovery codes" type="button">
            <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
              <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
        {copied ? <p className="idoc-auth-recovery-codes__copy-status" role="status">Recovery codes copied</p> : null}
        <ul aria-label="Recovery codes" className="idoc-auth-recovery-codes__list">
          {state.recoveryCodes.map((code) => <li className="idoc-auth-recovery-codes__item" key={code}><code>{code}</code></li>)}
        </ul>
      </div>
      <label className="idoc-auth-checkbox" htmlFor="saved">
        <input className="idoc-auth-checkbox__input" id="saved" name="saved" required type="checkbox" value="yes" />
        <span className="idoc-auth-checkbox__label">I saved my recovery codes.</span>
      </label>
      <button className="idoc-auth-button" disabled={acknowledging} type="submit">Finish sign in</button>
    </form>
  );
  if (mode === 'recovery-ack') return (
    <form action={cancel} className="idoc-auth-form">
      <CsrfField />
      <p className="idoc-auth-error" role="alert">The one-time recovery-code display is no longer available. Sign in again with your new authenticator, then generate a fresh recovery-code set from account security.</p>
      <input name="cancel" type="hidden" value="yes" />
      <button className="idoc-auth-button" type="submit">Sign in again</button>
    </form>
  );
  if (mode === 'recovery-entry') return (
    <>
      <form action={formAction} className="idoc-auth-form">
        <CsrfField />
        <div className="idoc-auth-field">
          <label className="idoc-auth-label" htmlFor="recoveryCode">Recovery code</label>
          <input autoComplete="off" autoFocus className="idoc-auth-input" id="recoveryCode" maxLength={64} name="recoveryCode" required />
        </div>
        {state.error ? <p className="idoc-auth-error" role="alert">{state.error}</p> : null}
        <button className="idoc-auth-button" disabled={pending} type="submit">{pending ? <AuthPendingLabel text="Checking" /> : 'Continue'}</button>
      </form>
      <form action={cancel}><CsrfField /><input name="cancel" type="hidden" value="yes" /><button type="submit">Cancel and sign in again</button></form>
    </>
  );
  return (
    <>
    <form action={formAction} className="idoc-auth-form">
      <CsrfField />
      {(mode === 'enrollment' || mode === 'replacement') && provisioningUri ? <>
        <p>Scan the QR code with your authenticator app, then enter the 6-digit code it generates.</p>
        <div className="idoc-auth-totp-enrollment">
          {qrCodeDataUrl ? <img alt="Authenticator QR code" className="idoc-auth-totp-enrollment__qr" height={200} src={qrCodeDataUrl} width={200} /> : null}
          <div className="idoc-auth-totp-enrollment__manual">
            <span>Manual setup key</span>
            <code>{totpSecretFromProvisioningUri(provisioningUri)}</code>
          </div>
        </div>
      </> : null}
      <div className="idoc-auth-otp">
        <InputOTP aria-label="Authenticator code" autoComplete="one-time-code" autoFocus disabled={pending} maxLength={6} name="code" onChange={setCode} pattern={REGEXP_ONLY_DIGITS} required value={code}>
          <InputOTPGroup className="grid w-full grid-cols-6 gap-2">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <InputOTPSlot className="h-[52px] w-full rounded-[10px] border-[1.5px] border-slate-200 bg-white text-xl font-semibold text-slate-900" index={index} key={index} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      {mode === 'challenge' && rememberDeviceEnabled ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input name="remember" type="checkbox" />
          Remember this device for {rememberDeviceDays} days
        </label>
      ) : null}
      {state.error ? <p className="idoc-auth-error" role="alert">{state.error}</p> : null}
      <button className="idoc-auth-button" disabled={pending} type="submit">{pending ? <AuthPendingLabel text="Verifying" /> : 'Verify'}</button>
    </form>
    {(mode === 'challenge' || mode === 'step-up') && hasWebAuthn ? <PasskeyButton mode={mode} /> : null}
    {mode === 'challenge' ? <form action={recover}><CsrfField /><input name="recover" type="hidden" value="yes" />
      <button disabled={recovering} type="submit">Use a recovery code</button></form> : null}
    {mode === 'replacement' ? <form action={cancel}><CsrfField /><input name="cancel" type="hidden" value="yes" />
      <button type="submit">Cancel and sign in again</button></form> : null}
    </>
  );
}
