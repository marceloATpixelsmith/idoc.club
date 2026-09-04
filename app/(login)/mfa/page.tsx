import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { AuthShell } from '@/components/auth/auth-shell';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { mfaConfiguration } from '@/lib/runtime/configuration';
import { getPendingPrimaryAuth } from '@/lib/auth/mfa/pending-primary-auth';
import { getPendingStepUp } from '@/lib/auth/mfa/step-up';
import { mfaStore } from '@/lib/auth/mfa/store';
import { decryptTotpSecret, totpProvisioningUri } from '@/lib/auth/mfa/totp';
import { MfaForm } from './mfa-form';

export default async function MfaPage() {
  const pending = await getPendingPrimaryAuth();
  if (!pending) {
    const stepUp = await getPendingStepUp();
    if (!stepUp) redirect('/sign-in');
    return <AuthShell description="Enter the current 6-digit code from your authenticator app to continue."
      title="Verify it's you"><MfaForm hasWebAuthn={stepUp.hasWebAuthn} mode="step-up" /></AuthShell>;
  }
  let provisioningUri: string | undefined;
  let qrCodeDataUrl: string | undefined;
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
    qrCodeDataUrl = await QRCode.toDataURL(provisioningUri);
  }
  const setup = pending.stage === 'enrollment' || pending.stage === 'replacement';
  const recoveryAck = pending.stage === 'recovery-ack';
  const rememberedDevice = pending.stage === 'challenge' ? mfaConfiguration().rememberedDevice : undefined;
  return <AuthShell description={pending.stage === 'recovery-entry' ? 'Use a saved recovery code to replace your authenticator.'
    : recoveryAck ? 'Save the new recovery codes before finishing sign in.'
    : setup ? 'Set up your authenticator app to continue.' : 'Enter the current code from your authenticator app.'}
    title={pending.stage === 'recovery-entry' ? 'Authenticator recovery' : recoveryAck ? 'Finish authenticator recovery'
      : setup ? 'Set up authenticator' : 'Two-step verification'}>
    <MfaForm hasWebAuthn={pending.stage === 'challenge' && pending.hasWebAuthn} mode={pending.stage} provisioningUri={provisioningUri}
      qrCodeDataUrl={qrCodeDataUrl} rememberDeviceDays={rememberedDevice?.days} rememberDeviceEnabled={rememberedDevice?.enabled} />
  </AuthShell>;
}
