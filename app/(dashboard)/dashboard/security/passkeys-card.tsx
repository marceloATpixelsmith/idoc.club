'use client';

import { useState } from 'react';
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

export function PasskeysCard({ passkeys }: { passkeys: Passkey[] }) {
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [deviceName, setDeviceName] = useState('');

  async function addPasskey() {
    setBusy(true); setError(undefined); setSuccess(undefined);
    try {
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
    } catch {
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
    } catch {
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
