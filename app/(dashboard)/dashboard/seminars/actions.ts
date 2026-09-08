'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { cancelOwnRegistration, registerForSeminar } from '@/lib/seminars/registrations';
import { createSeminarCheckoutSession } from '@/lib/seminars/checkout';

export type MemberSeminarState = { error?: string; success?: string };
const KNOWN_ERROR_NAMES = ['AuthorizationError', 'CsrfError', 'SeminarRegistrationError'];

export async function registerForSeminarAction(_state: MemberSeminarState, formData: FormData): Promise<MemberSeminarState> {
  const seminarId = formData.get('seminarId');
  let outcome: { paymentMethod: string; registrationId: number };
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    outcome = await registerForSeminar(seminarId);
  } catch (error) {
    if (error instanceof Error && KNOWN_ERROR_NAMES.includes(error.name)) return { error: error.message };
    return { error: 'Registration could not be completed.' };
  }
  revalidatePath('/dashboard/seminars');
  revalidatePath('/seminars');
  if (outcome.paymentMethod !== 'online_stripe') return { success: 'You are registered for this seminar.' };
  let checkoutUrl: string;
  try {
    checkoutUrl = await createSeminarCheckoutSession(outcome.registrationId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Payment could not be started.' };
  }
  redirect(checkoutUrl);
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
  return { success: 'Your registration has been canceled.' };
}
