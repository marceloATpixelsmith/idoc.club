import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { hasValidLoginDeviceTrust } from '@/lib/auth/login-device-trust';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from '@/lib/auth/mfa/login';
import { mfaStore } from '@/lib/auth/mfa/store';
import { listActiveSessions } from '@/lib/auth/session-registry';
import { getActivityLogs, getSecurityPageUser } from '@/lib/db/queries';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { SecurityClient } from './security-client';
import { FlashBanner } from '@/components/ui/flash-banner';
import { readUiFlash } from '@/lib/ui/flash-state';

export default async function SecurityPage() {
  const [user, session, flash] = await Promise.all([getSecurityPageUser(), getSession(), readUiFlash('/dashboard/security')]);
  if (!user || !session || session.sessionId.startsWith('legacy-')) redirect('/sign-in');
  if (user.accountState === 'onboarding') redirect('/dashboard');
  const role = await authoritativeMfaRole(user.id);
  const privileged = role === 'admin' || role === 'super-admin';
  // Administrators/Super Admins are never members and must never be gated by membership payment
  // status. An ordinary member with an existing profile that isn't currently entitled gets bounced
  // to the paywall, same as every other dashboard sub-page. An onboarding account is redirected to
  // My Membership above before any security-management data is read.
  if (!privileged) {
    const member = await getOwnPrivateMember();
    if (member && !isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))) redirect('/dashboard');
  }
  const [sessions, currentDeviceRemembered, factor, logs] = await Promise.all([
    listActiveSessions(user.id, user.sessionVersion),
    privileged ? Promise.resolve(false) : hasValidLoginDeviceTrust(user),
    privileged ? mfaStore.getActiveTotp(String(user.id), MFA_APPLICATION_ID) : Promise.resolve(null),
    getActivityLogs(),
  ]);
  const flashMessage = flash === 'google-linked' ? 'Google account connected successfully.'
    : flash === 'google-verification-required' ? 'Fresh verification is required before connecting Google.'
      : flash === 'google-auth-failed' ? 'Google account connection could not be completed. Please try again.'
        : null;
  return <>
    {flashMessage ? <div className="px-5 lg:px-8"><FlashBanner targetPath="/dashboard/security">{flashMessage}</FlashBanner></div> : null}
    <SecurityClient currentDeviceRemembered={currentDeviceRemembered} currentSessionId={session.sessionId}
      hasPassword={user.hasPassword}
      logs={logs.map(({ action, id, timestamp }) => ({ action, id, timestamp: timestamp.toISOString() }))}
      privileged={privileged} sessions={sessions.map(({ absoluteExpiresAt, authenticatedAt, deviceLabel, lastActivityAt, sessionId }) =>
        ({ absoluteExpiresAt, authenticatedAt, deviceLabel, lastActivityAt, sessionId }))} totpConfigured={Boolean(factor)} />
  </>;
}
