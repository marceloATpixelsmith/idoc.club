'use client';

import { useActionState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import {
  recordGoogleOauthRotationEvidenceForm,
  type RotationEvidenceFormState,
} from './actions';

export function GoogleOauthRotationForm({ activeVersion }: { activeVersion: string }) {
  const [state, formAction, isPending] = useActionState<RotationEvidenceFormState, FormData>(
    recordGoogleOauthRotationEvidenceForm,
    {},
  );
  return (
    <form action={formAction} className="mt-4 max-w-xl space-y-3">
      <CsrfField />
      <p className="text-sm text-gray-700">
        The server currently reports active version <strong>{activeVersion}</strong>. This button does not rotate or
        reveal a secret. Use it only after the new secret is active and a real Google sign-in has succeeded.
      </p>
      <Button className="rounded-full" disabled={isPending} type="submit">
        {isPending ? 'Recording…' : 'Record completed rotation'}
      </Button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="text-sm text-green-700">{state.success}</p>}
    </form>
  );
}
