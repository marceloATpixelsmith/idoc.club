'use client';

import { useActionState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { beginGoogleIdentityLink, disconnectGoogleIdentity } from './actions';

const fetcher = (url: string) => fetch(url).then((response) => response.json());
type State = { error?: string; success?: string };

export function GoogleIdentityCard() {
  const { data, mutate } = useSWR<{ linked: boolean }>('/api/auth/google/link/status', fetcher);
  const [linkState, linkAction, linkPending] = useActionState<State, FormData>(beginGoogleIdentityLink, {});
  const [unlinkState, unlinkAction, unlinkPending] = useActionState<State, FormData>(async (state, formData) => {
    const result = await disconnectGoogleIdentity(state, formData);
    await mutate();
    return result;
  }, {});
  const linked = data?.linked === true;

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
          {(linkState.error || unlinkState.error) && (
            <p className="text-red-500 text-sm">{linkState.error || unlinkState.error}</p>
          )}
          {(linkState.success || unlinkState.success) && (
            <p className="text-green-500 text-sm">{linkState.success || unlinkState.success}</p>
          )}
          <Button type="submit" disabled={linkPending || unlinkPending} variant={linked ? 'outline' : 'default'}>
            {linked ? 'Disconnect Google' : 'Connect Google'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
