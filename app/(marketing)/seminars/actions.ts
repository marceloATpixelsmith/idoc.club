'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { verifyTurnstile } from '@/lib/auth/turnstile';
import { checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';
import { registerAsGuestForSeminar, SeminarRegistrationError } from '@/lib/seminars/registrations';
import { createSeminarCheckoutSession } from '@/lib/seminars/checkout';

export type GuestSeminarState = {
  email?: string; error?: string; fieldErrors?: { email?: string; name?: string; paymentMethod?: string }; name?: string; success?: string;
};

const guestSeminarSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(255),
  name: z.string().trim().min(1, 'Enter your full name.').max(200),
  paymentMethod: z.string().min(1, 'Choose a payment method.'),
  seminarId: z.string().min(1, 'Seminar not found.'),
  turnstileToken: z.string().min(1, 'Please complete the verification challenge.'),
});

/** The anonymous, no-account seminar registration path -- reuses requireCsrfToken's existing
 * pre-authentication support (null session/subject, see sign-up/actions.ts), plus the same
 * Turnstile + per-email/per-origin rate limit every other anonymous write/email surface in this app
 * requires (lib/(marketing)/contact/actions.ts). Deliberately does not use the shared
 * validatedAction helper: that helper's own schema.safeParse would reject on the very first bad
 * field before this function ever ran, giving no chance to echo the submitted name/email back to
 * the form -- exactly the "your typed name and email vanish after a bad email" bug this replaces. */
export async function registerAsGuestForSeminarAction(_state: GuestSeminarState, formData: FormData): Promise<GuestSeminarState> {
  await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  const echo = { email: String(formData.get('email') ?? ''), name: String(formData.get('name') ?? '') };

  const result = guestSeminarSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) {
    const fieldErrors: NonNullable<GuestSeminarState['fieldErrors']> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if ((field === 'email' || field === 'name' || field === 'paymentMethod') && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return { ...echo, error: result.error.issues[0]?.message ?? 'Check the highlighted fields and try again.', fieldErrors };
  }
  const { email, name, paymentMethod, seminarId, turnstileToken } = result.data;

  const origin = await requestOrigin();
  if (!(await verifyTurnstile(turnstileToken, origin, 'seminar_guest_registration'))) {
    return { ...echo, error: 'Verification challenge failed. Please try again.' };
  }
  if (!(await checkRateLimit('seminar_guest_registration', email, origin))) {
    return { ...echo, error: 'Too many attempts. Please try again in a few minutes.' };
  }

  let outcome: { paymentMethod: string; registrationId: number };
  try {
    outcome = await registerAsGuestForSeminar(seminarId, name, email, paymentMethod);
  } catch (error) {
    if (error instanceof SeminarRegistrationError) return { ...echo, error: error.message };
    return { ...echo, error: 'Registration could not be completed.' };
  }
  revalidatePath('/seminars');
  revalidatePath(`/seminars/${seminarId}`);
  if (outcome.paymentMethod !== 'online_stripe') return { success: 'You are registered for this seminar. A confirmation email is on its way.' };
  let checkoutUrl: string;
  try {
    checkoutUrl = await createSeminarCheckoutSession(outcome.registrationId);
  } catch (error) {
    return { ...echo, error: error instanceof Error ? error.message : 'Payment could not be started.' };
  }
  redirect(checkoutUrl);
}
