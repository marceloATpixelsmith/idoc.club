import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { users } from '@/lib/db/schema';
import { getPendingLogin } from '@/lib/auth/pending-login';
import { ActivatePasswordStep } from './activate-password-step';
import { EmailStep } from './email-step';
import { OtpStep } from './otp-step';
import { PasswordStep } from './password-step';

export default async function SignInPage() {
  const pending = await getPendingLogin();
  if (!pending) return <EmailStep />;
  if (!pending.verified) return <OtpStep email={pending.email} />;

  // Account-state routing happens only after successful control of the submitted email address, so
  // the public email-entry response never discloses whether the account is migrated or even exists.
  const [account] = await db.select({ accountState: users.accountState })
    .from(users).where(eq(users.email, pending.email)).limit(1);
  if (account?.accountState === 'migrated_pending') return <ActivatePasswordStep />;
  return <PasswordStep email={pending.email} />;
}
