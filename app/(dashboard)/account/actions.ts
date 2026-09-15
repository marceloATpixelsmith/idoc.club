'use server';

import { updateAccount } from '@/app/(login)/actions';
import { getOwnPrivateMember, updateMemberProfile } from '@/lib/membership/data-access';
import { parseMemberProfileFormData } from '@/lib/membership/validation';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import type { StepUpActionState } from '@/components/auth/fresh-step-up-action';

// Deliberately NOT exported: a 'use server' file turns every *exported* top-level function into
// an independently RPC-invokable Server Action with its own action ID, bypassing whatever a caller
// in this file (like saveOwnAccountAndProfileForm below) does before reaching it. Keeping this
// private means the CSRF check in saveOwnAccountAndProfileForm is the only way to reach it -- there
// is no second, unprotected entry point into a real member's profile mutation.
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

/** My Profile has a single Save button for the whole page, email included -- there is no separate
 * account-email form or button. `updateAccount` already no-ops (no step-up, no verification email)
 * when the submitted email matches the member's current one, so the common case (editing profile
 * fields without touching email) never triggers the step-up dialog; it only appears when the email
 * genuinely changed, exactly as it did in the old standalone account form. A privileged actor with
 * no member profile (never gated off this page -- see profile/page.tsx) only ever gets the account
 * half applied; there is no profile to save. */
export async function saveOwnAccountAndProfileForm(_state: StepUpActionState, formData: FormData): Promise<StepUpActionState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your session security check failed.' };
  }
  const accountResult = await updateAccount({}, formData) as StepUpActionState;
  if (accountResult.stepUpRequired || accountResult.error) return accountResult;
  const member = await getOwnPrivateMember();
  if (!member) return accountResult;
  const profileResult = await saveOwnMemberProfile(parseMemberProfileFormData(formData));
  if (profileResult.error) return profileResult;
  return { success: 'Your account and profile were updated.' };
}
