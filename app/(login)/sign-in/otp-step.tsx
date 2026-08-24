'use client';

import { OtpEntryStep } from '@/components/auth/otp-entry-step';
import { cancelLogin, resendLoginOtp, verifyLoginOtp } from './actions';

export function OtpStep({ email }: { email: string }) {
  return (
    <OtpEntryStep
      cancelAction={cancelLogin}
      description={<>We sent a 6-digit code to <strong>{email}</strong>.</>}
      resendAction={resendLoginOtp}
      title="Verify your email"
      verifyAction={verifyLoginOtp}
    />
  );
}
