'use client';

import { OtpEntryStep } from '@/components/auth/otp-entry-step';
import { cancelPasswordReset, resendPasswordResetOtp, verifyPasswordResetOtp } from './actions';

export function OtpStep({ email }: { email: string }) {
  return (
    <OtpEntryStep
      cancelAction={cancelPasswordReset}
      description={<>If an account uses <span className="font-semibold text-gray-900">{email}</span>, we sent it a 6-digit code.</>}
      resendAction={resendPasswordResetOtp}
      title="Enter your code"
      verifyAction={verifyPasswordResetOtp}
    />
  );
}
