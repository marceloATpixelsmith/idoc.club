'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { cancelOwnRegistration, registerForSeminar, registerForSeminarAtNonMemberPrice } from '@/lib/seminars/registrations';
import { createSeminarCheckoutSession } from '@/lib/seminars/checkout';
import { processStagingSeminarConfirmationBatch } from '@/lib/notifications/renewal-notices';
import { isStagingSeminarDirectDelivery } from '@/lib/seminars/registrations';

export type MemberSeminarState = { error?: string; success?: string; redirectTo?: string };
const KNOWN_ERROR_NAMES = ['AuthorizationError', 'CsrfError', 'SeminarRegistrationError'];

async function runOwnProfileRegistration(formData: FormData, register: (seminarId: unknown, paymentMethod: unknown) => Promise<{ paymentMethod: string; registrationId: number }>): Promise<MemberSeminarState> {
  const seminarId = formData.get('seminarId');
  let outcome: { paymentMethod: string; registrationId: number };
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    outcome = await register(seminarId, formData.get('paymentMethod'));
    if (outcome.paymentMethod !== 'online_stripe' && isStagingSeminarDirectDelivery()) {
      await processStagingSeminarConfirmationBatch();
    }
  } catch (error) {
    if (error instanceof Error && KNOWN_ERROR_NAMES.includes(error.name)) return { error: error.message };
    return { error: 'Registration could not be completed.' };
  }
  if (outcome.paymentMethod === 'cash_event' || outcome.paymentMethod === 'bank_transfer') {
    // The destination is a full page navigation. Returning before any seminar revalidation is
    // critical: revalidating /seminars can refresh the current detail route, remove the CTA because
    // the new registration is now visible, and unmount the component that performs the redirect.
    return { redirectTo: '/seminars?view=my' };
  }
  revalidatePath('/dashboard/seminars');
  revalidatePath('/seminars');
  let checkoutUrl: string;
  try {
    checkoutUrl = await createSeminarCheckoutSession(outcome.registrationId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Payment could not be started.' };
  }
  redirect(checkoutUrl);
}

export async function registerForSeminarAction(_state: MemberSeminarState, formData: FormData): Promise<MemberSeminarState> {
  return runOwnProfileRegistration(formData, registerForSeminar);
}

/** For a signed-in visitor with their own profile who cannot use the member price (see
 * registerForSeminarAtNonMemberPrice) -- same flow as registerForSeminarAction, just the
 * non-member-priced registration function underneath. */
export async function registerAtNonMemberPriceAction(_state: MemberSeminarState, formData: FormData): Promise<MemberSeminarState> {
  return runOwnProfileRegistration(formData, registerForSeminarAtNonMemberPrice);
}

export async function cancelSeminarRegistrationAction(_state: MemberSeminarState, formData: FormData): Promise<MemberSeminarState> {
  const seminarId = formData.get('seminarId');
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    await cancelOwnRegistration(seminarId);
  } catch (error) {
    if (error instanceof Error && KNOWN_ERROR_NAMES.includes(error.name)) return { error: error.message };
    return { error: 'Your registration could not be canceled.' };
  }
  revalidatePath('/dashboard/seminars');
  revalidatePath('/seminars');
  revalidatePath(`/seminars/${String(seminarId)}`);
  return { success: 'Your registration has been canceled.' };
}
