'use client';

import { useEffect, useState } from 'react';
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';
import { beginPasskeyRegistration, finishPasskeyRegistration, removePasskeyCredential } from './actions';

type Passkey = { credentialId: string; deviceName: string | null; createdAt: string; lastUsedAt: string | null };
// The underlying Server Actions' inferred return types keep validatedActionWithUser's own
// schema-failure branch as a syntactically separate union member, which defeats normal property
// narrowing here -- these describe the actual runtime shape for a direct (non-useActionState) call.
type BeginResult = { error?: string; ceremonyId?: string; options?: PublicKeyCredentialCreationOptionsJSON };
type ActionResult = { error?: string; success?: string };
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const GENERIC_ERROR = 'That could not be completed. Try again.';
const PENDING_DEVICE_NAME_KEY = 'idoc-pending-passkey-device-name';

/** A Server Action's redirect() (used here by beginPasskeyRegistration when fresh step-up is
 * required) works by throwing a special digest-tagged error -- Next.js's own action-call plumbing
 * still performs the real navigation regardless of what the calling code does with that throw, but
 * a surrounding try/catch that doesn't recognize it will treat it as a genuine failure. Without this
 * check, every step-up redirect flashed the generic "That could not be completed" error for an
 * instant before the browser actually navigated to /mfa -- a real production report, not a
 * hypothetical. */
function isNextRedirectError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' && (error as { digest: string }).digest.startsWith('NEXT_REDIRECT');
}

export function PasskeysCard({ passkeys }: { passkeys: Passkey[] }) {
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Registration is the one step-up-gated action that can never auto-apply after verification (a
  // browser only allows a biometric/security-key ceremony to start from a live click), so a
  // required step-up round trips through a full page navigation to /mfa and back, remounting this
  // component and clearing its local state. Restoring the label the member already typed from
  // sessionStorage (cleared once actually used) means that round trip only costs a second click, not
  // also retyping the label. Read in an effect, not a lazy useState initializer, so the very first
  // client render still matches the server-rendered (always-empty) markup -- sessionStorage doesn't
  // exist during SSR at all.
  const [deviceName, setDeviceName] = useState('');
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(PENDING_DEVICE_NAME_KEY);
      if (pending) setDeviceName(pending);
    } catch { /* best-effort only */ }
  }, []);

  async function addPasskey() {
    setBusy(true); setError(undefined); setSuccess(undefined);
    try {
      try { sessionStorage.setItem(PENDING_DEVICE_NAME_KEY, deviceName); } catch { /* best-effort only */ }
      const beginFormData = new FormData();
      beginFormData.set('csrf_token', readCsrfTokenFromDocumentCookie());
      const begin = await beginPasskeyRegistration({}, beginFormData) as BeginResult;
      if (begin.error) { setError(begin.error); return; }
      if (!begin.ceremonyId || !begin.options) { setError(GENERIC_ERROR); return; }
      let response;
      try {
        response = await startRegistration({ optionsJSON: begin.options });
      } catch {
        setError('Passkey setup was cancelled or not completed.');
        return;
      }
      const formData = new FormData();
      formData.set('csrf_token', readCsrfTokenFromDocumentCookie());
      formData.set('ceremonyId', String(begin.ceremonyId));
      formData.set('credentialJson', JSON.stringify(response));
      if (deviceName.trim()) formData.set('deviceName', deviceName.trim());
      const finish = await finishPasskeyRegistration({}, formData) as ActionResult;
      if (finish.error) { setError(finish.error); return; }
      setSuccess(finish.success ?? 'Passkey added.');
      setDeviceName('');
      try { sessionStorage.removeItem(PENDING_DEVICE_NAME_KEY); } catch { /* best-effort only */ }
    } catch (thrown) {
      if (isNextRedirectError(thrown)) throw thrown;
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(credentialId: string) {
    setBusy(true); setError(undefined); setSuccess(undefined);
    try {
      const formData = new FormData();
      formData.set('csrf_token', readCsrfTokenFromDocumentCookie());
      formData.set('credentialId', credentialId);
      const result = await removePasskeyCredential({}, formData) as ActionResult;
      if (result.error) { setError(result.error); return; }
      setSuccess(result.success ?? 'Passkey removed.');
    } catch (thrown) {
      if (isNextRedirectError(thrown)) throw thrown;
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-8">
      <CardHeader><CardTitle>Passkeys</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-500">Optional. A passkey or security key can be used instead of your authenticator app code when signing in.</p>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        {success ? <p className="text-sm text-green-500">{success}</p> : null}
        {passkeys.length > 0 ? <ul className="space-y-2">
          {passkeys.map((passkey) => (
            <li className="flex items-center justify-between rounded-md border p-3 text-sm" key={passkey.credentialId}>
              <div>
                <p className="font-medium">{passkey.deviceName || 'Passkey'}</p>
                <p className="text-gray-500">Added {formatDate(passkey.createdAt)}
                  {passkey.lastUsedAt ? `; last used ${formatDate(passkey.lastUsedAt)}` : ''}</p>
              </div>
              <Button disabled={busy} onClick={() => removePasskey(passkey.credentialId)} type="button" variant="outline">Remove</Button>
            </li>
          ))}
        </ul> : null}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="mb-2" htmlFor="passkey-device-name">Label (optional)</Label>
            <Input id="passkey-device-name" maxLength={100} onChange={(event) => setDeviceName(event.target.value)}
              placeholder="e.g. MacBook Touch ID" value={deviceName} />
          </div>
          <Button disabled={busy} onClick={addPasskey} type="button">Add a passkey</Button>
        </div>
      </CardContent>
    </Card>
  );
}
