import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { hasValidLoginDeviceTrust } from '@/lib/auth/login-device-trust';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from '@/lib/auth/mfa/login';
import { mfaStore } from '@/lib/auth/mfa/store';
import { listActiveSessions } from '@/lib/auth/session-registry';
import { getActivityLogs, getSecurityPageUser, getUser } from '@/lib/db/queries';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { SecurityClient } from './security-client';

export default async function SecurityPage() {
  const account = await getUser();
  if (account?.accountState === 'onboarding') redirect('/dashboard');
  const [user, session] = await Promise.all([getSecurityPageUser(), getSession()]);
  if (!user || !session || session.sessionId.startsWith('legacy-')) redirect('/sign-in');
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
  return <SecurityClient currentDeviceRemembered={currentDeviceRemembered} currentSessionId={session.sessionId}
    logs={logs.map(({ action, id, timestamp }) => ({ action, id, timestamp: timestamp.toISOString() }))}
    privileged={privileged} sessions={sessions.map(({ absoluteExpiresAt, authenticatedAt, deviceLabel, lastActivityAt, sessionId }) =>
      ({ absoluteExpiresAt, authenticatedAt, deviceLabel, lastActivityAt, sessionId }))} totpConfigured={Boolean(factor)} />;
}
