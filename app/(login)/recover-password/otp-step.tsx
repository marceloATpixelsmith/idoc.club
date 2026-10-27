'use client';

import { OtpEntryStep } from '@/components/auth/otp-entry-step';
import { cancelPasswordReset, resendPasswordResetOtp, verifyPasswordResetOtp } from './actions';

export function OtpStep({ pendingCsrfNonce }: { pendingCsrfNonce: string }) {
  return (
    <OtpEntryStep
      cancelAction={cancelPasswordReset}
      description={<>If this email belongs to an account, we have emailed it either a 6-digit code to enter below or a link to set your password; if you received a link, open it instead. If your account uses an authenticator app, use its current code. Please check your spam folder for the email.</>}
      pendingCsrfNonce={pendingCsrfNonce}
      resendAction={resendPasswordResetOtp}
      title="Verify your identity"
      verifyAction={verifyPasswordResetOtp}
    />
  );
}
