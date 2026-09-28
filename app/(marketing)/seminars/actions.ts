'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { registerAsGuestForSeminar } from '@/lib/seminars/registrations';
import { createSeminarCheckoutSession } from '@/lib/seminars/checkout';

export type GuestSeminarState = { error?: string; success?: string };
const KNOWN_ERROR_NAMES = ['CsrfError', 'SeminarRegistrationError'];

/** The anonymous, no-account seminar registration path -- reuses requireCsrfToken's existing
 * pre-authentication support (see sign-up/actions.ts's own null session/subject calls) rather than
 * the multi-step pending-nonce variant, since this is a single-step form. */
export async function registerAsGuestForSeminarAction(_state: GuestSeminarState, formData: FormData): Promise<GuestSeminarState> {
  const seminarId = formData.get('seminarId');
  let outcome: { paymentMethod: string; registrationId: number };
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    outcome = await registerAsGuestForSeminar(seminarId, formData.get('name'), formData.get('email'), formData.get('paymentMethod'));
  } catch (error) {
    if (error instanceof Error && KNOWN_ERROR_NAMES.includes(error.name)) return { error: error.message };
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
}
