import 'server-only';

import { lt } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import {
  accountTokens,
  authSessions,
  emailDeliveryLog,
  emailDeliveryPendingEvents,
  emailOtpCodes,
  loginTrustedDevices,
  mfaChallengeTransactions,
  mfaEnrollmentTransactions,
  userActivityEvents,
} from '@/lib/db/schema';

// Logical invalidation (revoked/expired rows are already treated as unauthorized everywhere they're
// read) has never depended on physical deletion, so this grace period exists purely to leave a window
// for security-incident investigation of recently-expired records before they're gone for good, not to
// satisfy any access-control requirement. 30 days is a conservative default, not a compliance-mandated
// value; every column purged from is the same "expires_at" a row already becomes unusable at, so a
// revoked-but-not-yet-expired row (e.g. an admin-revoked session) is untouched until its own expiry
// passes this same grace period, exactly like a naturally-expired one.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// The administrator Member timeline's own activity log (docs/05): about thirteen months, long enough to answer a member's
// question about last year's renewal, short enough not to become a standing record of visitor behavior.
const ACTIVITY_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
// The email delivery log (docs/05): long enough to investigate a delivery complaint after the fact and to cover Brevo's own 90-day
// log window, short enough not to become a standing record of who was emailed.
const DELIVERY_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
// A webhook event held for a send that was never logged (sent before logging began) is discarded after two days.
const PENDING_EVENT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

/** Physically deletes rows from every table AUTH-STORAGE-007 named as growing unbounded, once each
 * row's own expiry is more than RETENTION_MS in the past. Safe to run repeatedly and concurrently:
 * each DELETE is a single bounded statement with no cross-table transaction, so a partial run (e.g. the
 * process is killed mid-batch) simply leaves the remaining tables for the next scheduled run. */
export async function purgeExpiredAuthRecords(now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const activityCutoff = new Date(now.getTime() - ACTIVITY_RETENTION_MS);
  const deliveryLogCutoff = new Date(now.getTime() - DELIVERY_LOG_RETENTION_MS);
  const pendingEventCutoff = new Date(now.getTime() - PENDING_EVENT_RETENTION_MS);
  const [emailOtp, mfaChallenge, mfaEnrollment, accountToken, authSession, loginTrustedDevice, userActivity, deliveryLog, pendingEvents] = await Promise.all([
    db.delete(emailOtpCodes).where(lt(emailOtpCodes.expiresAt, cutoff)).returning({ id: emailOtpCodes.id }),
    db.delete(mfaChallengeTransactions).where(lt(mfaChallengeTransactions.expiresAt, cutoff)).returning({ id: mfaChallengeTransactions.transactionId }),
    db.delete(mfaEnrollmentTransactions).where(lt(mfaEnrollmentTransactions.expiresAt, cutoff)).returning({ id: mfaEnrollmentTransactions.transactionId }),
    db.delete(accountTokens).where(lt(accountTokens.expiresAt, cutoff)).returning({ id: accountTokens.id }),
    db.delete(authSessions).where(lt(authSessions.absoluteExpiresAt, cutoff)).returning({ id: authSessions.id }),
    db.delete(loginTrustedDevices).where(lt(loginTrustedDevices.expiresAt, cutoff)).returning({ id: loginTrustedDevices.trustedDeviceId }),
    db.delete(userActivityEvents).where(lt(userActivityEvents.occurredAt, activityCutoff)).returning({ id: userActivityEvents.id }),
    // Its webhook events go with it (ON DELETE CASCADE).
    db.delete(emailDeliveryLog).where(lt(emailDeliveryLog.sentAt, deliveryLogCutoff)).returning({ id: emailDeliveryLog.id }),
    db.delete(emailDeliveryPendingEvents).where(lt(emailDeliveryPendingEvents.receivedAt, pendingEventCutoff)).returning({ id: emailDeliveryPendingEvents.id }),
  ]);
  return {
    accountTokens: accountToken.length,
    emailDeliveryLog: deliveryLog.length,
    emailDeliveryPendingEvents: pendingEvents.length,
    authSessions: authSession.length,
    emailOtpCodes: emailOtp.length,
    loginTrustedDevices: loginTrustedDevice.length,
    mfaChallengeTransactions: mfaChallenge.length,
    mfaEnrollmentTransactions: mfaEnrollment.length,
    userActivityEvents: userActivity.length,
  };
}
