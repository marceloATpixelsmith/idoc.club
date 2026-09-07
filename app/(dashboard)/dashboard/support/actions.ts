'use server';

import { redirect } from 'next/navigation';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { createConversation, replyAsMember } from '@/lib/support/inbox';

export type SupportFormState = { error?: string };
async function csrf(formData: FormData) { await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId()); }
function errorState(error: unknown): SupportFormState {
  if (error instanceof Error && (error.name === 'CsrfError' || error.name === 'SupportValidationError')) return { error: error.message };
  return { error: 'Your support request could not be saved.' };
}

export async function createSupportConversation(_state: SupportFormState, formData: FormData): Promise<SupportFormState> {
  let publicId: string;
  try {
    await csrf(formData);
    publicId = await createConversation({ body: formData.get('body'), category: formData.get('category'), idempotencyKey: formData.get('idempotencyKey'), subject: formData.get('subject') });
  } catch (error) { return errorState(error); }
  redirect(`/dashboard/support/${publicId}`);
}

export async function replyToSupportConversation(_state: SupportFormState, formData: FormData): Promise<SupportFormState> {
  try {
    await csrf(formData);
    await replyAsMember({ body: formData.get('body'), idempotencyKey: formData.get('idempotencyKey'), publicId: formData.get('publicId') });
  } catch (error) { return errorState(error); }
  redirect(`/dashboard/support/${String(formData.get('publicId'))}`);
}
