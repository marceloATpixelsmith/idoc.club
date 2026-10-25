import 'server-only';

import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';
import { accountTokens } from '@/lib/db/schema';
import type { AccountTokenPurpose } from '@/lib/membership/account-recovery';
import { recordUserActivity } from './user-activity';

const EVENT_FOR_OPEN = { migration_activation: 'activation_link_opened', password_reset: 'password_reset_link_opened' } as const;
const EVENT_FOR_SUBMIT = { migration_activation: 'activation_submitted', password_reset: 'password_reset_submitted' } as const;

async function tokenRecord(rawToken: string, purpose: AccountTokenPurpose) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const [record] = await db.select({ consumedAt: accountTokens.consumedAt, expiresAt: accountTokens.expiresAt, userId: accountTokens.userId })
    .from(accountTokens).where(and(eq(accountTokens.tokenHash, tokenHash), eq(accountTokens.purpose, purpose))).limit(1);
  return record ?? null;
}

/** An emailed activation/reset link reached its page: records who it was for and whether it was still usable. Best-effort. */
export async function recordTokenLinkOpened(rawToken: string, purpose: AccountTokenPurpose): Promise<void> {
  try {
    const record = await tokenRecord(rawToken, purpose);
    if (!record) return;
    const outcome = record.consumedAt ? 'already_used' : record.expiresAt.getTime() <= Date.now() ? 'expired' : 'valid';
    await recordUserActivity(record.userId, EVENT_FOR_OPEN[purpose], { outcome });
  } catch { /* observing a link must not break the page */ }
}

/** The activation/reset form was submitted: records whether it worked and, if not, the categorical reason. Best-effort. */
export async function recordTokenSubmitted(rawToken: string, purpose: AccountTokenPurpose, status: string): Promise<void> {
  try {
    const record = await tokenRecord(rawToken, purpose);
    if (!record) return;
    await recordUserActivity(record.userId, EVENT_FOR_SUBMIT[purpose], { outcome: status === 'success' ? 'success' : status === 'breached_password' ? 'breached_password' : 'rejected' });
  } catch { /* observing a submission must not change its result */ }
}
