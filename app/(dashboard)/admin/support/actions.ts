'use server';

import { revalidatePath } from 'next/cache';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { replyAsAdministrator, setCategoryDefault, setConversationAssignment, setConversationClosed } from '@/lib/support/inbox';

export type AdminSupportState = { error?: string; success?: string };
async function run(formData: FormData, operation: () => Promise<void>, success: string): Promise<AdminSupportState> {
  try { await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId()); await operation(); revalidatePath('/admin/support'); return { success }; }
  catch (error) {
    if (error instanceof Error && ['CsrfError', 'SupportValidationError', 'AuthorizationError'].includes(error.name)) return { error: error.message };
    return { error: 'The support update could not be saved.' };
  }
}
export async function replyToSupportAsAdmin(_state: AdminSupportState, formData: FormData) {
  return run(formData, () => replyAsAdministrator({ body: formData.get('body'), idempotencyKey: formData.get('idempotencyKey'), publicId: formData.get('publicId') }), 'Reply sent.');
}
export async function assignSupportConversation(_state: AdminSupportState, formData: FormData) {
  return run(formData, () => setConversationAssignment(formData.get('publicId'), formData.getAll('administratorIds')), 'Assignment updated.');
}
export async function changeSupportConversationStatus(_state: AdminSupportState, formData: FormData) {
  return run(formData, () => setConversationClosed(formData.get('publicId'), formData.get('operation') === 'close'), 'Status updated.');
}
export async function updateSupportCategoryDefault(_state: AdminSupportState, formData: FormData) {
  return run(formData, () => setCategoryDefault(formData.get('category'), formData.getAll('administratorIds')), 'Category default updated.');
}
