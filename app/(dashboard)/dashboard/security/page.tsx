import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { hasValidLoginDeviceTrust } from '@/lib/auth/login-device-trust';
import { authoritativeMfaRole, MFA_APPLICATION_ID } from '@/lib/auth/mfa/login';
import { mfaStore } from '@/lib/auth/mfa/store';
import { listActiveSessions } from '@/lib/auth/session-registry';
import { getSecurityPageUser } from '@/lib/db/queries';
import { SecurityClient } from './security-client';

export default async function SecurityPage() {
  const [user, session] = await Promise.all([getSecurityPageUser(), getSession()]);
  if (!user || !session || session.sessionId.startsWith('legacy-')) redirect('/sign-in');
  const role = await authoritativeMfaRole(user.id);
  const privileged = role === 'admin' || role === 'super-admin';
  const [sessions, currentDeviceRemembered, factor] = await Promise.all([
    listActiveSessions(user.id, user.sessionVersion),
    privileged ? Promise.resolve(false) : hasValidLoginDeviceTrust(user),
    privileged ? mfaStore.getActiveTotp(String(user.id), MFA_APPLICATION_ID) : Promise.resolve(null),
  ]);
  return <SecurityClient currentDeviceRemembered={currentDeviceRemembered} currentSessionId={session.sessionId}
    privileged={privileged} sessions={sessions.map(({ absoluteExpiresAt, authenticatedAt, deviceLabel, lastActivityAt, sessionId }) =>
      ({ absoluteExpiresAt, authenticatedAt, deviceLabel, lastActivityAt, sessionId }))} totpConfigured={Boolean(factor)} />;
}
