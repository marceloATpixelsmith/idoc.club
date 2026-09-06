'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Lock, Trash2, Loader2 } from 'lucide-react';
import { beginAuthenticatorReplacement, forgetAllRememberedDevices, forgetThisDevice, logOutOtherSessions, logOutSession, regenerateRecoveryCodes } from './actions';
import { Suspense, useActionState } from 'react';
import { updatePassword, deleteAccount } from '@/app/(login)/actions';
import { CsrfField } from '@/components/security/csrf-field';
import { GoogleIdentityCard } from './google-identity-card';
import { PasswordField } from './password-field';

type PasswordState = { error?: string; success?: string };
type RecoveryState = PasswordState & { recoveryCodes?: string[] };
type DeleteState = { error?: string; success?: string };
type ActivityLogEntry = { action: string; id: number; timestamp: string };
type SecurityClientProps = { currentDeviceRemembered: boolean; currentSessionId: string; logs: ActivityLogEntry[]; privileged: boolean; sessions: Array<{ absoluteExpiresAt: string; authenticatedAt: string; deviceLabel: string | null; lastActivityAt: string; sessionId: string }>; totpConfigured: boolean };
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

const ACTIVITY_LABELS: Record<string, string> = {
  ACCEPT_INVITATION: 'Accepted an invitation',
  CREATE_TEAM: 'Created a new team',
  DELETE_ACCOUNT: 'Deleted account',
  INVITE_TEAM_MEMBER: 'Invited a team member',
  REMOVE_TEAM_MEMBER: 'Removed a team member',
  SIGN_IN: 'Signed in',
  SIGN_OUT: 'Signed out',
  SIGN_UP: 'Signed up',
  UPDATE_ACCOUNT: 'Updated account',
  UPDATE_PASSWORD: 'Changed password',
};

export function SecurityClient({ currentDeviceRemembered, currentSessionId, logs, privileged, sessions, totpConfigured }: SecurityClientProps) {
  const [passwordState, passwordAction, isPasswordPending] = useActionState<PasswordState, FormData>(updatePassword, {});
  const [deleteState, deleteAction, isDeletePending] = useActionState<DeleteState, FormData>(deleteAccount, {});
  const [replaceState, replaceAction] = useActionState<PasswordState, FormData>(beginAuthenticatorReplacement, {});
  const [recoveryState, recoveryAction, isRecoveryPending] = useActionState<RecoveryState, FormData>(regenerateRecoveryCodes, {});
  const [forgetCurrentState, forgetCurrentAction] = useActionState<PasswordState, FormData>(forgetThisDevice, {});
  const [forgetAllState, forgetAllAction] = useActionState<PasswordState, FormData>(forgetAllRememberedDevices, {});
  const [logoutOneState, logoutOneAction] = useActionState<PasswordState, FormData>(logOutSession, {});
  const [logoutOthersState, logoutOthersAction] = useActionState<PasswordState, FormData>(logOutOtherSessions, {});

  return (
    <section className="flex-1 p-4 lg:p-8">
      <h1 className="text-lg lg:text-2xl font-medium bold text-foreground mb-6">Security Settings</h1>
      <div className="mb-8 grid gap-8 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Password</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">Changing your password logs you out on every device, including this one.</p><form className="space-y-4" action={passwordAction}>
              <CsrfField />
              <PasswordField autoComplete="current-password" id="current-password" label="Current Password" maxLength={100} minLength={8} name="currentPassword" required />
              <PasswordField autoComplete="new-password" id="new-password" label="New Password" maxLength={100} minLength={8} name="newPassword" required />
              {passwordState.error && <p className="text-red-400 text-sm">{passwordState.error}</p>}
              {passwordState.success && <p className="text-green-400 text-sm">{passwordState.success}</p>}
              <Button type="submit" className="bg-primary hover:opacity-90 text-primary-foreground" disabled={isPasswordPending}>
                {isPasswordPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating...</> : <><Lock className="mr-2 h-4 w-4" />Update Password</>}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Suspense fallback={null}>
          <GoogleIdentityCard />
        </Suspense>
      </div>

      {privileged ? <>
      <Card className="mb-8"><CardHeader><CardTitle>Authenticator app</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Status: {totpConfigured ? 'Configured' : 'Setup required'}. Recovery codes are one-time.</p>
        {replaceState.error ? <p className="text-sm text-red-400">{replaceState.error}</p> : null}
        {recoveryState.error ? <p className="text-sm text-red-400">{recoveryState.error}</p> : null}
        {recoveryState.recoveryCodes ? <><p className="text-sm font-medium">Save these codes now. They will not be shown again.</p>
          <ul aria-label="New recovery codes">{recoveryState.recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul></> : null}
        {totpConfigured ? <div className="flex flex-wrap gap-3"><form action={replaceAction}><CsrfField /><Button type="submit" variant="outline">Replace authenticator</Button></form>
          <form action={recoveryAction}><CsrfField /><Button type="submit" variant="outline" disabled={isRecoveryPending}>{isRecoveryPending ? 'Generating…' : 'Generate new recovery codes'}</Button></form></div> : null}
      </CardContent></Card>
      </> : <Card className="mb-8"><CardHeader><CardTitle>Remembered devices</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">This browser is {currentDeviceRemembered ? 'remembered for password sign-in verification' : 'not currently remembered'}.</p>
        {(forgetCurrentState.error || forgetAllState.error) ? <p className="text-sm text-red-400">{forgetCurrentState.error || forgetAllState.error}</p> : null}
        {(forgetCurrentState.success || forgetAllState.success) ? <p className="text-sm text-green-400">{forgetCurrentState.success || forgetAllState.success}</p> : null}
        <div className="flex flex-wrap gap-3"><form action={forgetCurrentAction}><CsrfField /><Button disabled={!currentDeviceRemembered} type="submit" variant="outline">Forget this device</Button></form>
        <form action={forgetAllAction}><CsrfField /><Button type="submit" variant="outline">Forget all remembered devices</Button></form></div>
      </CardContent></Card>}

      <Card className="mb-8"><CardHeader><CardTitle>Active sessions</CardTitle></CardHeader><CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">These are the signed-in sessions for your account. Each shows the browser and device it was created from, so you can confirm every entry is one of yours.</p>
        {(logoutOneState.error || logoutOthersState.error) ? <p className="text-sm text-red-400">{logoutOneState.error || logoutOthersState.error}</p> : null}
        {(logoutOneState.success || logoutOthersState.success) ? <p className="text-sm text-green-400">{logoutOneState.success || logoutOthersState.success}</p> : null}
        {sessions.map((session) => <div className="rounded-md border p-4" key={session.sessionId}>
          <p className="font-medium">{session.sessionId === currentSessionId ? 'Current session' : 'Another session'}{session.deviceLabel ? ` — ${session.deviceLabel}` : ''}</p>
          <dl className="mt-2 grid gap-1 text-sm text-muted-foreground"><div>Authenticated: {formatDate(session.authenticatedAt)}</div><div>Last activity: {formatDate(session.lastActivityAt)}</div><div>Expires: {formatDate(session.absoluteExpiresAt)}</div></dl>
          {session.sessionId !== currentSessionId ? <form action={logoutOneAction} className="mt-3"><CsrfField /><input name="sessionId" type="hidden" value={session.sessionId} /><Button type="submit" variant="outline">Log out this session</Button></form> : null}
        </div>)}
        <form action={logoutOthersAction}><CsrfField /><Button type="submit" variant="outline">Log out other sessions</Button></form>
      </CardContent></Card>

      <Card className="mb-8">
        <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
        <CardContent>
          {logs.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : (
            <div className="overflow-x-auto">
              <table className="min-w-full border text-sm">
                <thead>
                  <tr className="border-b bg-surface text-left">
                    <th className="p-2">Date</th>
                    <th className="p-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b">
                      <td className="p-2">{formatDate(log.timestamp)}</td>
                      <td className="p-2">{ACTIVITY_LABELS[log.action] ?? log.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Delete Account</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">Account deletion is irreversible. Please proceed with caution.</p>
          <form action={deleteAction} className="space-y-4">
            <CsrfField />
            <PasswordField autoComplete="current-password" id="delete-password" label="Confirm Password" maxLength={100} minLength={8} name="password" required />
            {deleteState.error && <p className="text-red-400 text-sm">{deleteState.error}</p>}
            <Button type="submit" variant="destructive" className="bg-red-600 hover:bg-red-700" disabled={isDeletePending}>
              {isDeletePending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deleting...</> : <><Trash2 className="mr-2 h-4 w-4" />Delete Account</>}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
