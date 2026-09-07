'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { createSeminar, setSeminarStatus, updateSeminar } from '@/lib/seminars/seminars';
import { markRegistrationPaymentReceived } from '@/lib/seminars/registrations';

export type AdminSeminarState = { error?: string; success?: string };

function seminarFields(formData: FormData) {
  return {
    capacity: formData.get('capacity'), description: formData.get('description'), endTime: formData.get('endTime'),
    location: formData.get('location'), paymentMethodId: formData.get('paymentMethodId'), price: formData.get('price'),
    registrationDeadline: formData.get('registrationDeadline'), seminarDate: formData.get('seminarDate'),
    startTime: formData.get('startTime'), status: formData.get('status'), timezone: formData.get('timezone'), title: formData.get('title'),
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

export async function publishSeminarAction(_state: AdminSeminarState, formData: FormData) {
  const id = formData.get('id');
  return run(formData, () => setSeminarStatus(id, 'published'), 'Seminar published.', `/admin/seminars/${id}`);
}

export async function cancelSeminarAction(_state: AdminSeminarState, formData: FormData) {
  const id = formData.get('id');
  return run(formData, () => setSeminarStatus(id, 'canceled'), 'Seminar canceled.', `/admin/seminars/${id}`);
}

export async function revertSeminarToDraftAction(_state: AdminSeminarState, formData: FormData) {
  const id = formData.get('id');
  return run(formData, () => setSeminarStatus(id, 'draft'), 'Seminar moved back to draft.', `/admin/seminars/${id}`);
}

export async function markSeminarRegistrationPaidAction(_state: AdminSeminarState, formData: FormData) {
  const seminarId = formData.get('seminarId');
  return run(formData, () => markRegistrationPaymentReceived(formData.get('registrationId')), 'Payment recorded.', `/admin/seminars/${seminarId}`);
}
