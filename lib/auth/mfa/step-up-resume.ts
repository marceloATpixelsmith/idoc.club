import 'server-only';

import { updateAccount } from '@/app/(login)/actions';
import { removePasskeyCredential } from '@/app/(dashboard)/dashboard/security/actions';
import { recordGoogleOauthRotationEvidenceForm } from '@/app/(dashboard)/admin/security/actions';
import { forceRevokeAllAuthorityForm, grantRoleForm, revokeRoleForm } from '@/app/(dashboard)/admin/members/actions';
import { currentCsrfToken } from '@/lib/security/csrf';
import type { PendingStepUp } from './step-up';

type ResumeResult = { error?: string; success?: string } & Record<string, unknown>;

/** The member's own action was already fully formed and submitted before the server discovered
 * fresh step-up was needed -- their real input (which role, which user, the reason they typed, the
 * new email address) is sitting right here in `pending.resume.payload`. Replaying it as this exact
 * FormData through the exact same production action the browser would have called is what makes the
 * requested action actually happen the instant the code is accepted, instead of only sending the
 * member back to a page where nothing happened yet and they must redo the whole submission. The
 * CSRF token is minted fresh here (a legitimate server-side actor, not attacker-controlled input)
 * since the resumed call never actually crossed the network as a browser form submission. */
async function replay(payload: Record<string, string>): Promise<FormData> {
  const formData = new FormData();
  for (const [name, value] of Object.entries(payload)) formData.set(name, value);
  formData.set('csrf_token', (await currentCsrfToken()) ?? '');
  return formData;
}

const RESUMERS: Record<string, (formData: FormData) => Promise<ResumeResult>> = {
  'force-revoke-authority': (formData) => forceRevokeAllAuthorityForm({}, formData),
  'grant-role': (formData) => grantRoleForm({}, formData),
  'record-google-rotation-evidence': (formData) => recordGoogleOauthRotationEvidenceForm({}, formData),
  'remove-passkey': (formData) => removePasskeyCredential({}, formData),
  'revoke-role': (formData) => revokeRoleForm({}, formData),
  'update-account-email': (formData) => updateAccount({}, formData),
};

/** Applies `pending`'s original request now that its fresh step-up code has just been accepted, and
 * returns the URL to send the member to -- `pending.returnTo` with the outcome appended as a query
 * parameter (never the result payload itself: nothing resumable here returns secret data -- see
 * `PendingStepUp`'s doc comment for the actions deliberately excluded from this mechanism because
 * they do). */
export async function resumeStepUpAction(pending: PendingStepUp): Promise<string> {
  const resume = pending.resume;
  if (!resume) return pending.returnTo;
  const resumer = RESUMERS[resume.kind];
  if (!resumer) return pending.returnTo;
  const separator = pending.returnTo.includes('?') ? '&' : '?';
  // None of RESUMERS' actions ever call redirect() themselves on success -- each one only returns a
  // plain { success } / { error } result -- so there is no competing redirect to let propagate here.
  const result = await resumer(await replay(resume.payload));
  return result.error
    ? `${pending.returnTo}${separator}stepUpError=${encodeURIComponent(result.error)}`
    : `${pending.returnTo}${separator}stepUpApplied=1`;
}
