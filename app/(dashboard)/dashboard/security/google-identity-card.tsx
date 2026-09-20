'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CsrfField } from '@/components/security/csrf-field';
import { beginGoogleIdentityLink, createPasswordAndDisconnectGoogle, disconnectGoogleIdentity, sendGoogleDisconnectVerificationCode } from './actions';
import { PasswordField } from './password-field';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';

const fetcher = (url: string) => fetch(url).then((response) => response.json());
type State = { error?: string; success?: string };

const GOOGLE_RESULT_MESSAGES: Record<string, { error?: string; success?: string }> = {
  linked: { success: 'Google account connected.' },
  collision: { error: 'That Google account is already connected to another IDOC account.' },
  'different-google-identity-already-linked': { error: 'A different Google account is already connected to this IDOC account.' },
  'verification-required': { error: 'Verify your current password again before connecting Google.' },
  failed: { error: 'Google account connection could not be completed. Please try again.' },
};

export function GoogleIdentityCard({ hasPassword }: { hasPassword: boolean }) {
  const searchParams = useSearchParams();
  const { data, mutate } = useSWR<{ linked: boolean }>('/api/auth/google/link/status', fetcher);
  const [linkState, linkAction, linkPending, linkDialog] = useFreshStepUpAction(beginGoogleIdentityLink, {} as State);
  const [unlinkState, unlinkAction, unlinkPending, unlinkDialog] = useFreshStepUpAction(async (state, formData) => {
    const result = await disconnectGoogleIdentity(state, formData);
    await mutate();
    return result;
  }, {} as State);
  const [createState, createAction, createPending, createDialog] = useFreshStepUpAction(createPasswordAndDisconnectGoogle, {} as State);
  const [sendCodeState, sendCodeAction, sendCodePending] = useActionState<State, FormData>(sendGoogleDisconnectVerificationCode, {} as State);
  const linked = data?.linked === true;
  const callbackState = GOOGLE_RESULT_MESSAGES[searchParams.get('google') ?? ''];
  // A linked account with no real password (Google-only signup) can never satisfy the
  // current-password field disconnectGoogleIdentity requires -- see docs/21 AUTH-OAUTH-009 -- so
  // this card offers the one control that actually applies to it: create a password, which becomes
  // this account's new sign-in method as the same action disconnects Google.
  const needsPasswordToDisconnect = linked && !hasPassword;
  const error = linkState.error || unlinkState.error || createState.error || callbackState?.error;
  const success = linkState.success || unlinkState.success || callbackState?.success;

  return (
    <><Card className="mb-8">
      <CardHeader>
        <CardTitle>Google Sign-In</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          {needsPasswordToDisconnect
            ? 'A Google account is connected to your IDOC account. Send a verification code to your email, then create a password to sign in without Google and disconnect it.'
            : linked ? 'A Google account is connected to your IDOC account.' : 'Connect Google as an additional way to sign in to IDOC.'}
        </p>
        {needsPasswordToDisconnect ? (
          <div className="space-y-4">
            <form action={sendCodeAction}>
              <CsrfField />
              <Button type="submit" disabled={sendCodePending} variant="outline" size="sm">
                {sendCodePending ? 'Sending…' : 'Send verification code'}
              </Button>
              {sendCodeState.error && <p className="text-red-400 text-sm mt-2">{sendCodeState.error}</p>}
              {sendCodeState.success && <p className="text-green-400 text-sm mt-2">{sendCodeState.success}</p>}
            </form>
            <form action={createAction} className="space-y-4">
              <CsrfField />
              <div>
                <Label htmlFor="google-otp-code" className="mb-2">Verification Code</Label>
                <Input
                  autoComplete="one-time-code"
                  id="google-otp-code"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  name="otpCode"
                  pattern="\d{6}"
                  placeholder="6-digit code from your email"
                  required
                  type="text"
                />
              </div>
              <PasswordField autoComplete="new-password" id="google-new-password" label="New Password" maxLength={128} minLength={12} name="newPassword" required />
              {error && <p className="text-red-400 text-sm">{error}</p>}
              {success && <p className="text-green-400 text-sm">{success}</p>}
              <Button type="submit" disabled={createPending} variant="outline">Create password and disconnect Google</Button>
            </form>
          </div>
        ) : (
          <form action={linked ? unlinkAction : linkAction} className="space-y-4">
            <CsrfField />
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
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">{success}</p>}
            <Button type="submit" disabled={linkPending || unlinkPending} variant={linked ? 'outline' : 'default'}>
              {linked ? 'Disconnect Google' : 'Connect Google'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>{linkDialog}{unlinkDialog}{createDialog}</>
  );
}
