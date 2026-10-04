'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { createConversation, replyAsMember, setOwnConversationClosed } from '@/lib/support/inbox';

export type SupportFormState = { error?: string; success?: string };
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
  redirect(`/contact/${encodeURIComponent(publicId)}`);
}

export async function replyToSupportConversation(_state: SupportFormState, formData: FormData): Promise<SupportFormState> {
  try {
    await csrf(formData);
    await replyAsMember({ body: formData.get('body'), idempotencyKey: formData.get('idempotencyKey'), publicId: formData.get('publicId') });
  } catch (error) { return errorState(error); }
  redirect(`/contact/${encodeURIComponent(String(formData.get('publicId')))}`);
}

/** The member's own equivalent of the admin's changeSupportConversationStatus -- typically used
 * once an administrator's fix is confirmed working, so the member can close the request out
 * themselves rather than leaving it open indefinitely. Close-only, deliberately: per
 * docs/08's Support Inbox contract only an administrator may reopen a conversation, so this
 * never reads a client-supplied direction (an `operation`/boolean field a tampered request could
 * flip to reopen) -- it always calls setOwnConversationClosed with `true`. */
export async function closeOwnConversation(_state: SupportFormState, formData: FormData): Promise<SupportFormState> {
  const publicId = String(formData.get('publicId'));
  try {
    await csrf(formData);
    await setOwnConversationClosed(publicId, true);
  } catch (error) { return errorState(error); }
  revalidatePath(`/contact/${encodeURIComponent(publicId)}`);
  return { success: 'Conversation closed.' };
}
