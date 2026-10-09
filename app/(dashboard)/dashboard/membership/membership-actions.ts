'use server';

import { revalidatePath } from 'next/cache';
import { getUser } from '@/lib/db/queries';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { consumeFreshStepUp, requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { cancelOwnMembership } from '@/lib/membership/data-access';

type CancelMembershipState = { error?: string; stepUpRequired?: boolean; success?: string };

/** Self-service cancellation: the membership ends at the end of the current paid cycle (access
 * continues until then), the open Stripe subscription stops renewing, and the member leaves the
 * mailing list. The member stays signed in; once the paid-through date passes, sign-in is refused
 * (lib/membership/session-gate.ts). Distinct from Delete Account (Security page) and from the
 * Renewal Mode control, which only stops future billing. */
export async function cancelMembershipAction(_state: CancelMembershipState, formData: FormData): Promise<CancelMembershipState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await getUser();
    if (!actor) return { error: 'Sign in again to cancel your membership.' };
    if ((await requireFreshStepUp(actor, 'change-security-settings', '/dashboard/membership')).required) return { stepUpRequired: true };
    await cancelOwnMembership();
    await consumeFreshStepUp();
  } catch {
    return { error: 'Your membership could not be canceled. Please retry, or contact support.' };
  }
  revalidatePath('/dashboard/membership');
  return { success: 'Your membership has been canceled. You keep full access until the end of your current paid period.' };
}
