'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { cancelOwnRegistration, getSeminarPaymentMethodInstructions, registerForSeminar, registerForSeminarAtNonMemberPrice } from '@/lib/seminars/registrations';
import { createSeminarCheckoutSession } from '@/lib/seminars/checkout';

export type MemberSeminarState = { error?: string; success?: string };
const KNOWN_ERROR_NAMES = ['AuthorizationError', 'CsrfError', 'SeminarRegistrationError'];

async function runOwnProfileRegistration(formData: FormData, register: (seminarId: unknown, paymentMethod: unknown) => Promise<{ paymentMethod: string; registrationId: number }>): Promise<MemberSeminarState> {
  const seminarId = formData.get('seminarId');
  let outcome: { paymentMethod: string; registrationId: number };
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    outcome = await register(seminarId, formData.get('paymentMethod'));
  } catch (error) {
    if (error instanceof Error && KNOWN_ERROR_NAMES.includes(error.name)) return { error: error.message };
    return { error: 'Registration could not be completed.' };
  }
  revalidatePath('/dashboard/seminars');
  revalidatePath('/seminars');
  revalidatePath(`/seminars/${String(seminarId)}`);
  if (outcome.paymentMethod === 'cash_event') return { success: 'You are registered. Payment will be collected at the event.' };
  if (outcome.paymentMethod === 'bank_transfer') {
    const instructions = await getSeminarPaymentMethodInstructions('bank_transfer');
    return { success: `You are registered. ${instructions?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || 'Follow the bank transfer instructions provided by IDOC.'}` };
  }
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
