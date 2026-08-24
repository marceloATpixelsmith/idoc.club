'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { beginGoogleIdentityLink, disconnectGoogleIdentity } from './actions';

const fetcher = (url: string) => fetch(url).then((response) => response.json());
type State = { error?: string; success?: string };

const GOOGLE_RESULT_MESSAGES: Record<string, { error?: string; success?: string }> = {
  linked: { success: 'Google account connected.' },
  collision: { error: 'That Google account is already connected to another IDOC account.' },
  'different-google-identity-already-linked': { error: 'A different Google account is already connected to this IDOC account.' },
  'verification-required': { error: 'Verify your current password again before connecting Google.' },
  failed: { error: 'Google account connection could not be completed. Please try again.' },
};

export function GoogleIdentityCard() {
  const searchParams = useSearchParams();
  const { data, mutate } = useSWR<{ linked: boolean }>('/api/auth/google/link/status', fetcher);
  const [linkState, linkAction, linkPending] = useActionState<State, FormData>(beginGoogleIdentityLink, {});
  const [unlinkState, unlinkAction, unlinkPending] = useActionState<State, FormData>(async (state, formData) => {
    const result = await disconnectGoogleIdentity(state, formData);
    await mutate();
    return result;
  }, {});
  const linked = data?.linked === true;
  const callbackState = GOOGLE_RESULT_MESSAGES[searchParams.get('google') ?? ''];
  const error = linkState.error || unlinkState.error || callbackState?.error;
  const success = linkState.success || unlinkState.success || callbackState?.success;

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>Google Sign-In</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-500 mb-4">
          {linked ? 'A Google account is connected to your IDOC account.' : 'Connect Google as an additional way to sign in to IDOC.'}
        </p>
        <form action={linked ? unlinkAction : linkAction} className="space-y-4">
          <div>
            <Label htmlFor="google-current-password" className="mb-2">Current Password</Label>
            <Input
              id="google-current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              minLength={1}
              maxLength={128}
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {success && <p className="text-green-500 text-sm">{success}</p>}
          <Button type="submit" disabled={linkPending || unlinkPending} variant={linked ? 'outline' : 'default'}>
            {linked ? 'Disconnect Google' : 'Connect Google'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
