'use server';

import * as Sentry from '@sentry/nextjs';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getUser } from '@/lib/db/queries';
import { validatedAction } from '@/lib/auth/middleware';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { createMembershipPortalSession } from './stripe';
import { createMembershipCheckoutSession } from './checkout';
import { beginAutomaticRenewalSetup, cancelPendingRenewalChange, disableAutomaticRenewal } from './renewal-preferences';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';

const checkoutSchema = z.object({ mode: z.enum(['payment', 'subscription']) });

const EXPECTED_CHECKOUT_REFUSALS = [
  'An active or pending subscription already exists for this membership.',
  'This membership has been canceled and cannot be renewed.',
  'This membership is on hold and cannot be paid for. Contact support.',
];

export const checkoutAction = validatedAction(checkoutSchema, async ({ mode }) => {
  const user = await getUser();
  if (!user) redirect('/sign-in');
  let url: string;
  try {
    url = await createMembershipCheckoutSession(mode);
  } catch (error) {
    // An expected business-rule refusal is the member's answer, not a server fault: returning it keeps the form on screen with the
    // message instead of an unhandled throw (HTTP 500, a Server Components digest error and a client "Load failed" in Sentry).
    const message = error instanceof Error ? error.message : '';
    if (EXPECTED_CHECKOUT_REFUSALS.includes(message)) return { error: message };
    Sentry.captureException(error, { tags: { payment_operation: 'membership_checkout' } });
    return { error: 'Could not start checkout. Please try again, or contact support if it keeps happening.' };
  }
  redirect(url);
});

type BillingActionState = { error?: string; redirectUrl?: string; stepUpRequired?: boolean; success?: string };

// Returns the portal URL instead of redirecting server-side, so the caller can open it in a new
// tab/window rather than navigating the current dashboard away.
export async function manageBillingAction(_state: BillingActionState, formData: FormData): Promise<BillingActionState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    return { redirectUrl: await createMembershipPortalSession() };
  } catch {
    return { error: 'Could not open the billing portal. Please retry.' };
  }
}

async function protectedBillingMutation(formData: FormData, operation: () => Promise<string | void>): Promise<BillingActionState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await getUser();
    if (!actor) return { error: 'Sign in again to change billing settings.' };
    if ((await requireFreshStepUp(actor, 'change-security-settings', '/dashboard')).required) return { stepUpRequired: true };
    const redirectUrl = await operation();
    return typeof redirectUrl === 'string' ? { redirectUrl } : { success: 'Your renewal preference was updated.' };
  } catch {
    return { error: 'The billing change could not be completed. No billing state was assumed; please retry.' };
  }
}

export async function enableAutomaticRenewalAction(_state: BillingActionState, formData: FormData) {
  return protectedBillingMutation(formData, beginAutomaticRenewalSetup);
}
export async function disableAutomaticRenewalAction(_state: BillingActionState, formData: FormData) {
  return protectedBillingMutation(formData, disableAutomaticRenewal);
}
export async function cancelPendingRenewalAction(_state: BillingActionState, formData: FormData) {
  return protectedBillingMutation(formData, cancelPendingRenewalChange);
}
