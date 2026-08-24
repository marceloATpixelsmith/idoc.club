'use client';

import { OtpEntryStep } from '@/components/auth/otp-entry-step';
import { cancelPasswordReset, resendPasswordResetOtp, verifyPasswordResetOtp } from './actions';

export function OtpStep({ email }: { email: string }) {
  return (
    <OtpEntryStep
      cancelAction={cancelPasswordReset}
      description={<>We sent a 6-digit code to <strong>{email}</strong>.</>}
      resendAction={resendPasswordResetOtp}
      title="Verify your identity"
      verifyAction={verifyPasswordResetOtp}
    />
  );
}
