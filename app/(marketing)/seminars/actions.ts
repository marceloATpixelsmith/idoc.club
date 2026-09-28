'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { validatedAction, type ActionState } from '@/lib/auth/middleware';
import { verifyTurnstile } from '@/lib/auth/turnstile';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';
import { registerAsGuestForSeminar, SeminarRegistrationError } from '@/lib/seminars/registrations';
import { createSeminarCheckoutSession } from '@/lib/seminars/checkout';

export type GuestSeminarState = ActionState;

const guestSeminarSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(255),
  name: z.string().trim().min(1, 'Enter your full name.').max(200),
  paymentMethod: z.string().min(1, 'Choose a payment method.'),
  seminarId: z.string().min(1, 'Seminar not found.'),
  turnstileToken: z.string().min(1, 'Please complete the verification challenge.'),
});

/** The anonymous, no-account seminar registration path -- reuses validatedAction's existing
 * pre-authentication CSRF support (null session/subject, see sign-up/actions.ts) plus the same
 * Turnstile + per-email/per-origin rate limit every other anonymous write/email surface in this app
 * requires (lib/(marketing)/contact/actions.ts). Without it, an anonymous caller with nothing but a
 * CSRF token could reserve unlimited seats under distinct emails and trigger unlimited outbound
 * confirmation email with no account to hold accountable. */
export const registerAsGuestForSeminarAction = validatedAction(guestSeminarSchema, async ({ email, name, paymentMethod, seminarId, turnstileToken }) => {
  const origin = await requestOrigin();
  if (!(await verifyTurnstile(turnstileToken, origin, 'seminar_guest_registration'))) {
    return { error: 'Verification challenge failed. Please try again.' };
  }
  if (!(await checkRateLimit('seminar_guest_registration', email, origin))) {
    return { error: 'Too many attempts. Please try again in a few minutes.' };
  }
  let outcome: { paymentMethod: string; registrationId: number };
  try {
    outcome = await registerAsGuestForSeminar(seminarId, name, email, paymentMethod);
  } catch (error) {
    if (error instanceof SeminarRegistrationError) return { error: error.message };
    return { error: 'Registration could not be completed.' };
  }
  revalidatePath('/seminars');
  if (outcome.paymentMethod !== 'online_stripe') return { success: 'You are registered for this seminar. A confirmation email is on its way.' };
  let checkoutUrl: string;
  try {
    checkoutUrl = await createSeminarCheckoutSession(outcome.registrationId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Payment could not be started.' };
  }
  redirect(checkoutUrl);
});
