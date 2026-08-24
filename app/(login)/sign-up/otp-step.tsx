'use client';

import { OtpEntryStep } from '@/components/auth/otp-entry-step';
import { cancelSignup, resendSignupOtp, verifySignupOtp } from './actions';

export function OtpStep({ email }: { email: string }) {
  return (
    <OtpEntryStep
      cancelAction={cancelSignup}
      description={<>We sent a 6-digit code to <strong>{email}</strong>.</>}
      resendAction={resendSignupOtp}
      title="Verify your email"
      verifyAction={verifySignupOtp}
    />
  );
}
