'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [busy, setBusy] = useState(false);
  // A required step-up round trips through a full page navigation to /mfa and back, remounting this
  // component and clearing its local state. Restoring the label the member already typed from
  // sessionStorage means that round trip doesn't also cost retyping the label -- never anything
  // beyond this non-secret display label, and read exactly once (removed the instant it's read,
  // whether or not it turns out to be present) so a value written for one redirect can never
  // resurface on an unrelated later visit, and never survives into a different account's session in
  // the same tab after a sign-out. Read in an effect, not a lazy useState initializer, so the very
  // first client render still matches the server-rendered (always-empty) markup -- sessionStorage
  // doesn't exist during SSR at all.
  const [deviceName, setDeviceName] = useState('');
  // Set only when an automatic resume attempt got a real ceremony from the server but the browser
  // then refused to run it (no carried-over user activation) -- beginPasskeyRegistration's fresh
  // step-up evidence is already spent at that point, so a plain retry of "Add a passkey" would only
  // send the member back through /mfa to land on the exact same unsupported automatic attempt, an
  // infinite loop with no way out (a real Codex finding on the first version of this fix). Holding
  // onto the still-valid ceremony lets one ordinary click supply the gesture the browser withheld,
  // without spending step-up evidence a second time.
  const [pendingCeremony, setPendingCeremony] = useState<{ ceremonyId: string; deviceName: string;
    options: PublicKeyCredentialCreationOptionsJSON } | null>(null);
  const autoResumed = useRef(false);
  useEffect(() => {
    let restored = '';
    try {
      const pending = sessionStorage.getItem(PENDING_DEVICE_NAME_KEY);
      sessionStorage.removeItem(PENDING_DEVICE_NAME_KEY);
      if (pending) { restored = pending; setDeviceName(pending); }
    } catch { /* best-effort only */ }
    // Real production report: after verifying the TOTP code, the member landed back here having to
    // click "Add a passkey" a second time before the biometric/security-key ceremony actually ran.
    // Next.js's client-side navigation for a Server Action redirect() stays in the same Document (no
    // full page reload), so the transient user activation from the "Verify" click that triggered it
    // is still live when this component remounts here -- calling startRegistration() immediately,
    // still within that activation, lets the ceremony fire without a further click. A stale or
    // reloaded activation makes the browser refuse the ceremony instead of prompting for it; that
    // failure is handled below by asking for exactly one ordinary click, same as before this existed.
    if (!autoResumed.current && searchParams.get('resumeWebAuthn') === '1') {
      autoResumed.current = true;
      router.replace('/dashboard/security', { scroll: false });
      void beginAndRegister({ auto: true, nameOverride: restored });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs the actual browser ceremony for an already-issued challenge and, on success, submits it.
  // Kept separate from beginAndRegister below so a fallback click can retry just this part against a
  // still-valid ceremony without asking the server for a new one (which would require fresh step-up
  // evidence that's already been spent).
  async function runCeremony(ceremony: { ceremonyId: string; deviceName: string; options: PublicKeyCredentialCreationOptionsJSON }, auto: boolean) {
    let response;
    try {
      response = await startRegistration({ optionsJSON: ceremony.options });
    } catch {
      if (auto) {
        // Keep this still-valid ceremony so the fallback "Add a passkey" click below can finish it
        // with a real gesture, instead of calling beginPasskeyRegistration again -- its fresh step-up
        // evidence is already consumed, so that would only redirect back to /mfa and, once verified,
        // land right back on this same unsupported automatic attempt: an infinite loop with no exit.
        setPendingCeremony(ceremony);
        setError('Click "Add a passkey" to finish setting it up.');
      } else {
        setError('Passkey setup was cancelled or not completed.');
      }
      return;
    }
    setPendingCeremony(null);
    const formData = new FormData();
    formData.set('csrf_token', readCsrfTokenFromDocumentCookie());
    formData.set('ceremonyId', ceremony.ceremonyId);
    formData.set('credentialJson', JSON.stringify(response));
    if (ceremony.deviceName.trim()) formData.set('deviceName', ceremony.deviceName.trim());
    const finish = await finishPasskeyRegistration({}, formData) as ActionResult;
    if (finish.error) { setError(finish.error); return; }
    setSuccess(finish.success ?? 'Passkey added.');
    setDeviceName('');
  }

  async function beginAndRegister(options?: { auto?: boolean; nameOverride?: string }) {
    const effectiveName = options?.nameOverride ?? deviceName;
    setBusy(true); setError(undefined); setSuccess(undefined);
    try {
      const beginFormData = new FormData();
      beginFormData.set('csrf_token', readCsrfTokenFromDocumentCookie());
      const begin = await beginPasskeyRegistration({}, beginFormData) as BeginResult;
      if (begin.error) { setError(begin.error); return; }
      if (!begin.ceremonyId || !begin.options) { setError(GENERIC_ERROR); return; }
      await runCeremony({ ceremonyId: begin.ceremonyId, deviceName: effectiveName, options: begin.options }, Boolean(options?.auto));
    } catch (thrown) {
      if (isNextRedirectError(thrown)) {
        // About to navigate away to /mfa for step-up verification -- this component remounts once
        // the member returns, so persist only what's already in the field, only for this one
        // redirect (the effect above reads and immediately clears it, whether or not this path
        // actually runs again on this device).
        try { sessionStorage.setItem(PENDING_DEVICE_NAME_KEY, effectiveName); } catch { /* best-effort only */ }
        throw thrown;
      }
      setError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey() {
    if (pendingCeremony) {
      setBusy(true); setError(undefined); setSuccess(undefined);
      try {
        // Use whatever label is currently in the field, not the one captured when the automatic
        // attempt ran -- the member may have edited it while looking at the fallback message.
        await runCeremony({ ...pendingCeremony, deviceName }, false);
      } finally {
        setBusy(false);
      }
      return;
    }
    await beginAndRegister();
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
          <Button disabled={busy} onClick={() => addPasskey()} type="button">Add a passkey</Button>
        </div>
      </CardContent>
    </Card>
  );
}
