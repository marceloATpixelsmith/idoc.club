'use server';

import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { createSeminar, updateSeminar } from '@/lib/seminars/seminars';
import { processStagingSeminarConfirmationBatch } from '@/lib/notifications/renewal-notices';
import { createAdminSeminarRegistration, isStagingSeminarDirectDelivery, recordManualSeminarPayment, searchActiveMembersForRegistration, setAdminRegistrationApprovalStatus, setAdminRegistrationStatus, updateSeminarRegistrationDetails } from '@/lib/seminars/registrations';
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
    price: formData.get('price'),
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
    const eventId = Sentry.captureException(error, { tags: { area: 'admin-seminars', operation: 'save' } });
    const databaseError = error && typeof error === 'object' ? error as {
      code?: unknown; column_name?: unknown; constraint_name?: unknown; name?: unknown; schema_name?: unknown; table_name?: unknown;
    } : {};
    console.error('Unexpected admin seminar save failure', {
      code: typeof databaseError.code === 'string' ? databaseError.code : undefined,
      column: typeof databaseError.column_name === 'string' ? databaseError.column_name : undefined,
      constraint: typeof databaseError.constraint_name === 'string' ? databaseError.constraint_name : undefined,
      errorName: typeof databaseError.name === 'string' ? databaseError.name : undefined,
      eventId,
      schema: typeof databaseError.schema_name === 'string' ? databaseError.schema_name : undefined,
      table: typeof databaseError.table_name === 'string' ? databaseError.table_name : undefined,
    });
    return { error: `The seminar could not be saved. Error reference: ${eventId}` };
  }
}

export async function createSeminarAction(_state: AdminSeminarState, formData: FormData): Promise<AdminSeminarState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    await createSeminar(seminarFields(formData));
    revalidatePath('/admin/seminars');
    revalidatePath('/seminars');
    return { success: 'Seminar/course created.' };
  } catch (error) {
    if (error instanceof Error && ['AuthorizationError', 'CsrfError', 'SeminarValidationError'].includes(error.name)) return { error: error.message };
    return { error: 'The seminar could not be created.' };
  }
}

export async function updateSeminarAction(_state: AdminSeminarState, formData: FormData) {
  const id = formData.get('id');
  return run(formData, () => updateSeminar(id, seminarFields(formData)), 'Seminar/course saved.', '/admin/seminars');
}

export async function createAdminSeminarRegistrationAction(_state: AdminSeminarState, formData: FormData): Promise<AdminSeminarState> {
  return run(formData, async () => {
    await createAdminSeminarRegistration({
      approvalStatus: formData.get('approvalStatus'),
      paymentMethod: formData.get('paymentMethod'),
      paymentStatus: formData.get('paymentStatus'),
      profileId: formData.get('profileId'),
      seminarId: formData.get('seminarId'),
    });
    if (isStagingSeminarDirectDelivery()) await processStagingSeminarConfirmationBatch();
  }, 'Registration created.', '/admin/seminars/registrations');
}

/** Typeahead for the New Registration member lookup. Administrator-only (re-checked server-side) and
 * bounded; returns only the fields needed to identify one active member. */
export async function searchRegistrationMembersAction(query: string) {
  try {
    return await searchActiveMembersForRegistration(query);
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthorizationError') return [];
    throw error;
  }
}

export async function setAdminRegistrationApprovalStatusAction(_state: AdminSeminarState, formData: FormData) {
  return run(formData, async () => {
    await setAdminRegistrationApprovalStatus(formData.get('registrationId'), formData.get('approvalStatus'));
    // staging.idoc.club queues under its own kind that the production cron never claims, so drain it now.
    if (isStagingSeminarDirectDelivery()) await processStagingSeminarConfirmationBatch();
  }, 'Registration status updated.', '/admin/seminars/registrations');
}

export async function recordManualSeminarPaymentAction(_state: AdminSeminarState, formData: FormData) {
  return run(formData, async () => {
    await recordManualSeminarPayment(formData.get('registrationId'), formData.get('method'), formData.get('reference'));
    // staging.idoc.club queues the payment notice under its own kind that the production cron never claims, so drain it now.
    if (isStagingSeminarDirectDelivery()) await processStagingSeminarConfirmationBatch();
  }, 'Payment recorded.', '/admin/seminars/registrations');
}

export async function setAdminRegistrationStatusAction(_state: AdminSeminarState, formData: FormData) {
  return run(formData, () => setAdminRegistrationStatus(formData.get('registrationId'), formData.get('status')),
    'Registration updated.', '/admin/seminars/registrations');
}

export async function updateSeminarRegistrationDetailsAction(_state: AdminSeminarState, formData: FormData) {
  const registrationId = formData.get('registrationId');
  return run(formData, () => updateSeminarRegistrationDetails(registrationId, {
    paymentMethod: formData.get('paymentMethod'),
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
