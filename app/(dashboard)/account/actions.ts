'use server';

import { getOwnPrivateMember, updateMemberProfile } from '@/lib/membership/data-access';
import { parseMemberProfileFormData } from '@/lib/membership/validation';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';

// Deliberately NOT exported: a 'use server' file turns every *exported* top-level function into
// an independently RPC-invokable Server Action with its own action ID, bypassing whatever a caller
// in this file (like saveOwnMemberProfileForm below) does before reaching it. Keeping this private
// means the CSRF check in saveOwnMemberProfileForm is the only way to reach it -- there is no
// second, unprotected entry point into a real member's profile mutation.
async function saveOwnMemberProfile(input: unknown) {
  const member = await getOwnPrivateMember();
  if (!member) return { error: 'Complete account onboarding before editing your profile.' };
  try {
    await updateMemberProfile(member.profile.id, input);
    return { success: 'Your profile was updated and administrators were notified.' };
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') return { error: 'Review the highlighted profile fields.' };
    return { error: 'The profile could not be updated safely.' };
  }
}

export async function saveOwnMemberProfileForm(_state: { error?: string; success?: string }, formData: FormData): Promise<{ error?: string; success?: string }> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your session security check failed.' };
  }
  return saveOwnMemberProfile(parseMemberProfileFormData(formData));
}
