'use client';

import { OtpEntryStep } from '@/components/auth/otp-entry-step';
import { cancelPasswordReset, resendPasswordResetOtp, verifyPasswordResetOtp } from './actions';

export function OtpStep({ pendingCsrfNonce }: { pendingCsrfNonce: string }) {
  return (
    <OtpEntryStep
      cancelAction={cancelPasswordReset}
      description={<>Enter the 6-digit verification code for this recovery request. If your account uses an authenticator app, use its current code; otherwise use the code sent to your email.</>}
      pendingCsrfNonce={pendingCsrfNonce}
      resendAction={resendPasswordResetOtp}
      title="Verify your identity"
      verifyAction={verifyPasswordResetOtp}
    />
  );
}
