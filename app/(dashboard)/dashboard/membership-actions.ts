'use server';

import { redirect } from 'next/navigation';
import { getUser } from '@/lib/db/queries';
import { clearSession, rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { consumeFreshStepUp, requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { revokeAllUserSessions } from '@/lib/auth/session-registry';
import { forgetAllLoginDevices } from '@/lib/auth/login-device-trust';
import { cancelOwnMembership } from '@/lib/membership/data-access';

type CancelMembershipState = { error?: string; stepUpRequired?: boolean };

/** Self-service, immediate membership cancellation -- distinct from Delete Account (Security page)
 * and from the Renewal Mode control (which only stops future billing). Ends access now, best-effort
 * cancels any open Stripe subscription and removes the member from the mailing list, then revokes
 * every session/device and signs the member out, matching the security tier deleteAccount uses. */
export async function cancelMembershipAction(_state: CancelMembershipState, formData: FormData): Promise<CancelMembershipState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await getUser();
    if (!actor) return { error: 'Sign in again to cancel your membership.' };
    if ((await requireFreshStepUp(actor, 'change-security-settings', '/dashboard')).required) return { stepUpRequired: true };
    await cancelOwnMembership();
    await revokeAllUserSessions(actor.id, 'membership-canceled');
    await forgetAllLoginDevices(actor.id, 'membership-canceled');
    await consumeFreshStepUp();
    await clearSession();
  } catch {
    return { error: 'Your membership could not be canceled. Please retry, or contact support.' };
  }
  redirect('/sign-in?membership=canceled');
}
