import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { mfaConfiguration } from '@/lib/runtime/configuration';
import { getPendingPrimaryAuth } from '@/lib/auth/mfa/pending-primary-auth';
import { mfaStore } from '@/lib/auth/mfa/store';
import { decryptTotpSecret, totpProvisioningUri } from '@/lib/auth/mfa/totp';
import { MfaForm } from './mfa-form';

export default async function MfaPage() {
  const pending = await getPendingPrimaryAuth();
  if (!pending) redirect('/sign-in');
  if (pending.stage === 'recovery-ack') redirect('/sign-in');
  let provisioningUri: string | undefined;
  if (pending.stage === 'enrollment' || pending.stage === 'replacement') {
    const enrollment = await mfaStore.getPendingTotpEnrollment({ applicationId: pending.applicationId,
      factorId: pending.factorId, nowMs: Date.now(), subjectId: String(pending.subjectId), transactionId: pending.transactionId });
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, pending.subjectId)).limit(1);
    if (!enrollment || !user) redirect('/sign-in');
    const config = mfaConfiguration();
    provisioningUri = totpProvisioningUri({ accountLabel: user.email, issuer: 'IDOC',
      secret: decryptTotpSecret(enrollment.factor.encryptedSecret, (keyId) => {
        const key = config.encryptionKeys.get(keyId); if (!key) throw new Error('MFA key unavailable.'); return key;
      }) });
  }
  const setup = pending.stage === 'enrollment' || pending.stage === 'replacement';
  return <AuthShell description={pending.stage === 'recovery-entry' ? 'Use a saved recovery code to replace your authenticator.'
    : setup ? 'Add the new account to your authenticator app.' : 'Enter the current code from your authenticator app.'}
    title={pending.stage === 'recovery-entry' ? 'Authenticator recovery' : setup ? 'Set up authenticator' : 'Two-step verification'}>
    <MfaForm mode={pending.stage} provisioningUri={provisioningUri} />
  </AuthShell>;
}
