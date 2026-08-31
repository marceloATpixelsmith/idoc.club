import 'server-only';

import { lt } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  accountTokens,
  authSessions,
  emailOtpCodes,
  loginTrustedDevices,
  mfaChallengeTransactions,
  mfaEnrollmentTransactions,
} from '@/lib/db/schema';

// Logical invalidation (revoked/expired rows are already treated as unauthorized everywhere they're
// read) has never depended on physical deletion, so this grace period exists purely to leave a window
// for security-incident investigation of recently-expired records before they're gone for good, not to
// satisfy any access-control requirement. 30 days is a conservative default, not a compliance-mandated
// value; every column purged from is the same "expires_at" a row already becomes unusable at, so a
// revoked-but-not-yet-expired row (e.g. an admin-revoked session) is untouched until its own expiry
// passes this same grace period, exactly like a naturally-expired one.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Physically deletes rows from every table AUTH-STORAGE-007 named as growing unbounded, once each
 * row's own expiry is more than RETENTION_MS in the past. Safe to run repeatedly and concurrently:
 * each DELETE is a single bounded statement with no cross-table transaction, so a partial run (e.g. the
 * process is killed mid-batch) simply leaves the remaining tables for the next scheduled run. */
export async function purgeExpiredAuthRecords(now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const [emailOtp, mfaChallenge, mfaEnrollment, accountToken, authSession, loginTrustedDevice] = await Promise.all([
    db.delete(emailOtpCodes).where(lt(emailOtpCodes.expiresAt, cutoff)).returning({ id: emailOtpCodes.id }),
    db.delete(mfaChallengeTransactions).where(lt(mfaChallengeTransactions.expiresAt, cutoff)).returning({ id: mfaChallengeTransactions.transactionId }),
    db.delete(mfaEnrollmentTransactions).where(lt(mfaEnrollmentTransactions.expiresAt, cutoff)).returning({ id: mfaEnrollmentTransactions.transactionId }),
    db.delete(accountTokens).where(lt(accountTokens.expiresAt, cutoff)).returning({ id: accountTokens.id }),
    db.delete(authSessions).where(lt(authSessions.absoluteExpiresAt, cutoff)).returning({ id: authSessions.id }),
    db.delete(loginTrustedDevices).where(lt(loginTrustedDevices.expiresAt, cutoff)).returning({ id: loginTrustedDevices.trustedDeviceId }),
  ]);
  return {
    accountTokens: accountToken.length,
    authSessions: authSession.length,
    emailOtpCodes: emailOtp.length,
    loginTrustedDevices: loginTrustedDevice.length,
    mfaChallengeTransactions: mfaChallenge.length,
    mfaEnrollmentTransactions: mfaEnrollment.length,
  };
}
