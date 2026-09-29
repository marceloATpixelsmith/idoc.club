'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { createSeminar, updateSeminar } from '@/lib/seminars/seminars';
import { recordManualSeminarPayment, setAdminRegistrationStatus, updateSeminarRegistrationDetails } from '@/lib/seminars/registrations';
import { refundSeminarRegistration } from '@/lib/payments/refunds';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { requireAccountAccess } from '@/lib/membership/data-access';
import * as Sentry from '@sentry/nextjs';

export type AdminSeminarState = { error?: string; stepUpRequired?: boolean; success?: string };

function seminarFields(formData: FormData) {
  return {
    accommodationInformation: formData.get('accommodationInformation'), application: formData.get('application'), capacity: formData.get('capacity'),
    courseDirectors: formData.get('courseDirectors'), courseVenueInformation: formData.get('courseVenueInformation'), endDate: formData.get('endDate'),
    isFei: formData.get('isFei'), language: formData.get('language'), levels: formData.getAll('levels'), location: formData.get('location'),
    memberPrice: formData.get('memberPrice'), nonMemberPrice: formData.get('nonMemberPrice'), organizingNationalFederation: formData.get('organizingNationalFederation'),
    participantProfile: formData.get('participantProfile'), registrationDeadline: formData.get('registrationDeadline'), startDate: formData.get('startDate'),
    status: formData.get('status'), title: formData.get('title'),
  };
}

async function run(formData: FormData, operation: () => Promise<void>, success: string, path = '/admin/seminars'): Promise<AdminSeminarState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    await operation();
    revalidatePath(path);
    return { success };
  } catch (error) {
    if (error instanceof Error && ['AuthorizationError', 'CsrfError', 'SeminarRegistrationError', 'SeminarValidationError'].includes(error.name)) return { error: error.message };
    Sentry.captureException(error, { tags: { area: 'admin-seminars', operation: 'save' } });
    console.error('Unexpected admin seminar save failure; details captured by Sentry.');
    return { error: 'The seminar could not be saved.' };
  }
}

export async function createSeminarAction(_state: AdminSeminarState, formData: FormData) {
  let id: number;
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    id = await createSeminar(seminarFields(formData));
  } catch (error) {
    if (error instanceof Error && ['AuthorizationError', 'CsrfError', 'SeminarValidationError'].includes(error.name)) return { error: error.message };
    return { error: 'The seminar could not be created.' };
  }
  revalidatePath('/admin/seminars');
  redirect(`/admin/seminars/${id}`);
}

export async function updateSeminarAction(_state: AdminSeminarState, formData: FormData) {
  const id = formData.get('id');
  return run(formData, () => updateSeminar(id, seminarFields(formData)), 'Seminar saved.', `/admin/seminars/${id}`);
}

export async function recordManualSeminarPaymentAction(_state: AdminSeminarState, formData: FormData) {
  return run(formData, () => recordManualSeminarPayment(formData.get('registrationId'), formData.get('method'), formData.get('reference')),
    'Payment recorded.', '/admin/seminars/registrations');
}

export async function setAdminRegistrationStatusAction(_state: AdminSeminarState, formData: FormData) {
  return run(formData, () => setAdminRegistrationStatus(formData.get('registrationId'), formData.get('status')),
    'Registration updated.', '/admin/seminars/registrations');
}

export async function updateSeminarRegistrationDetailsAction(_state: AdminSeminarState, formData: FormData) {
  const registrationId = formData.get('registrationId');
  return run(formData, () => updateSeminarRegistrationDetails(registrationId, {
    guestEmail: formData.get('guestEmail'), guestFirstName: formData.get('guestFirstName'), guestLastName: formData.get('guestLastName'),
    guestPhone: formData.get('guestPhone'), paymentMethod: formData.get('paymentMethod'),
  }), 'Registration updated.', '/admin/seminars/registrations');
}

export async function refundSeminarRegistrationAction(_state: AdminSeminarState, formData: FormData): Promise<AdminSeminarState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    if ((await requireFreshStepUp(actor, 'change-security-settings', '/admin/seminars/registrations')).required) return { stepUpRequired: true };
    await refundSeminarRegistration(formData.get('registrationId'), formData.get('reason'));
    revalidatePath('/admin/seminars/registrations');
    return { success: 'Stripe completed the approved full refund.' };
  } catch (error) {
    if (error instanceof Error && ['AuthorizationError', 'CsrfError', 'RefundError'].includes(error.name)) return { error: error.message };
    return { error: 'The refund could not be completed. Review reconciliation before retrying.' };
  }
}
