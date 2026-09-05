'use client';

import { OtpEntryStep } from '@/components/auth/otp-entry-step';
import { cancelLogin, resendLoginOtp, verifyLoginOtp } from './actions';

export function OtpStep({ allowRemember, email, pendingCsrfNonce }: { allowRemember: boolean; email: string; pendingCsrfNonce: string }) {
  return (
    <OtpEntryStep
      cancelAction={cancelLogin}
      description={<>We sent a 6-digit code to <strong>{email}</strong>.</>}
      pendingCsrfNonce={pendingCsrfNonce}
      resendAction={resendLoginOtp}
      verifyFields={allowRemember ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input name="remember" type="checkbox" />
          Remember me for 2 weeks
        </label>
      ) : undefined}
      title="Verify your email"
      verifyAction={verifyLoginOtp}
    />
  );
}
