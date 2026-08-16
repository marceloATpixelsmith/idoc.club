'use server';

import { updateMemberProfile } from '@/lib/membership/data-access';
import { parseMemberProfileFormData } from '@/lib/membership/validation';

export async function saveMemberProfileByAdminForm(_state: { error?: string; success?: string }, formData: FormData): Promise<{ error?: string; success?: string }> {
  const profileId = Number(formData.get('profileId'));
  const reason = String(formData.get('reason') ?? '');
  try {
    await updateMemberProfile(profileId, parseMemberProfileFormData(formData), { reason });
    return { success: 'Profile updated and audit entry recorded.' };
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') return { error: 'Review the highlighted profile fields.' };
    if (error instanceof Error && error.name === 'AuthorizationError') return { error: 'You are not authorized to make this change.' };
    if (error instanceof Error && error.message === 'An administrative reason is required for this correction.') return { error: error.message };
    return { error: 'The profile could not be updated safely.' };
  }
}
