'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { guestContactSchema } from '@/lib/seminars/guest-registration-validation';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { verifyTurnstile } from '@/lib/auth/turnstile';
import { checkOriginRateLimit, checkRateLimit, requestOrigin } from '@/lib/security/rate-limit';
import { registerAsGuestForSeminar, SeminarRegistrationError } from '@/lib/seminars/registrations';
import { createGuestSeminarCheckoutSession, createSeminarCheckoutSession } from '@/lib/seminars/checkout';
import { processStagingSeminarConfirmationBatch } from '@/lib/notifications/renewal-notices';
import { isStagingSeminarDirectDelivery } from '@/lib/seminars/registrations';
import { setUiFlash } from '@/lib/ui/flash-state';

export type GuestSeminarState = {
  email?: string; error?: string; fieldErrors?: Partial<Record<'email' | 'firstName' | 'lastName' | 'paymentMethod' | 'phone', string>>; firstName?: string; lastName?: string; phone?: string; success?: string;
};

const guestSeminarSchema = guestContactSchema.extend({
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
  const echo = { email: String(formData.get('email') ?? ''), firstName: String(formData.get('firstName') ?? ''), lastName: String(formData.get('lastName') ?? ''), phone: String(formData.get('phone') ?? '') };

  const result = guestSeminarSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) {
    const fieldErrors: NonNullable<GuestSeminarState['fieldErrors']> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if ((field === 'email' || field === 'firstName' || field === 'lastName' || field === 'phone' || field === 'paymentMethod') && !fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    return { ...echo, error: result.error.issues[0]?.message ?? 'Check the highlighted fields and try again.', fieldErrors };
  }
  const { email, firstName, lastName, paymentMethod, phone, seminarId, turnstileToken } = result.data;
  if (paymentMethod === 'online_stripe') return { ...echo, error: 'Online payment must be completed in Stripe Checkout.' };

  const origin = await requestOrigin();
  if (!(await verifyTurnstile(turnstileToken, origin, 'seminar_guest_registration'))) {
    return { ...echo, error: 'Verification challenge failed. Please try again.' };
  }
  if (!(await checkRateLimit('seminar_guest_registration', email, origin))) {
    return { ...echo, error: 'Too many attempts. Please try again in a few minutes.' };
  }

  let outcome: { paymentMethod: string; registrationId: number };
  try {
    outcome = await registerAsGuestForSeminar(seminarId, firstName, lastName, email, phone, paymentMethod);
    if (isStagingSeminarDirectDelivery()) await processStagingSeminarConfirmationBatch();
  } catch (error) {
    if (error instanceof SeminarRegistrationError) return { ...echo, error: error.message };
    return { ...echo, error: 'Registration could not be completed.' };
  }
  revalidatePath('/seminars');
  revalidatePath(`/seminars/${seminarId}`);
  if (outcome.paymentMethod === 'cash_event' || outcome.paymentMethod === 'bank_transfer') {
    const targetPath = `/seminars/${seminarId}`;
    await setUiFlash('seminar-registration-success', targetPath);
    redirect(targetPath);
  }
  let checkoutUrl: string;
  try {
    checkoutUrl = await createSeminarCheckoutSession(outcome.registrationId);
  } catch (error) {
    return { ...echo, error: error instanceof Error ? error.message : 'Payment could not be started.' };
  }
  redirect(checkoutUrl);
}


/** Anonymous online payment is Stripe-first: IDOC asks for no contact information before redirect.
 * Turnstile/CSRF and an origin-scoped rate limit still protect creation of provider sessions. */
export type GuestStripeCheckoutState = { error?: string; attempt?: number };

export async function startGuestSeminarStripeCheckoutAction(state: GuestStripeCheckoutState, formData: FormData): Promise<GuestStripeCheckoutState> {
  await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  const seminarId = formData.get('seminarId');
  const turnstileToken = String(formData.get('turnstileToken') ?? '');
  const origin = await requestOrigin();
  if (!(await verifyTurnstile(turnstileToken, origin, 'seminar_guest_registration'))) {
    return { attempt: (state.attempt ?? 0) + 1, error: 'Verification challenge failed. Please try again.' };
  }
  if (!(await checkOriginRateLimit('seminar_guest_checkout', origin))) {
    return { attempt: (state.attempt ?? 0) + 1, error: 'Too many attempts. Please try again in a few minutes.' };
  }
  try {
    redirect(await createGuestSeminarCheckoutSession(seminarId));
  } catch (error) {
    if (error instanceof SeminarRegistrationError) return { attempt: (state.attempt ?? 0) + 1, error: error.message };
    throw error;
  }
}
