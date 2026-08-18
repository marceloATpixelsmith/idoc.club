'use client';

import { OtpEntryStep } from '@/components/auth/otp-entry-step';
import { cancelLogin, resendLoginOtp, verifyLoginOtp } from './actions';

export function OtpStep({ email }: { email: string }) {
  return (
    <OtpEntryStep
      cancelAction={cancelLogin}
      description={<>Since this is your first sign-in on the new site, we sent a 6-digit code to <span className="font-semibold text-gray-900">{email}</span>.</>}
      resendAction={resendLoginOtp}
      title="Verify your email"
      verifyAction={verifyLoginOtp}
    />
  );
}
