'use server';

import { redirect } from 'next/navigation';
import { recordActiveGoogleOauthSecretRotation } from '@/lib/auth/google-oidc-secret-audit';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireSuperAdmin } from '@/lib/membership/authorization';
import { requireCsrfToken } from '@/lib/security/csrf';

export type RotationEvidenceFormState = { error?: string; success?: string };

function friendlyError(error: unknown): RotationEvidenceFormState {
  if (error instanceof Error && error.name === 'AuthorizationError') {
    return { error: 'Super Admin authorization is required.' };
  }
  if (error instanceof Error && error.name === 'CsrfError') return { error: error.message };
  if (error instanceof Error && [
    'Your session is no longer valid. Sign in again.',
    'Authenticator verification is required. Use the approved account recovery path.',
  ].includes(error.message)) return { error: error.message };
  return { error: 'The rotation evidence could not be recorded safely.' };
}

async function rotationEvidenceNeedsStepUp(): Promise<RotationEvidenceFormState | { actorId: number; required: boolean }> {
  try {
    const actor = await requireAccountAccess('administration');
    requireSuperAdmin(actor);
    const { required } = await requireFreshStepUp(actor, 'change-security-settings', '/admin/security',
      { kind: 'record-google-rotation-evidence', payload: {} });
    return { actorId: actor.id, required };
  } catch (error) {
    return friendlyError(error);
  }
}

export async function recordGoogleOauthRotationEvidenceForm(
  _state: RotationEvidenceFormState,
  formData: FormData,
): Promise<RotationEvidenceFormState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
  } catch (error) {
    return friendlyError(error);
  }
  const authorization = await rotationEvidenceNeedsStepUp();
  if (!('actorId' in authorization)) return authorization;
  if (authorization.required) redirect('/mfa');
  try {
    const result = await recordActiveGoogleOauthSecretRotation(authorization.actorId);
    return result.status === 'already-recorded'
      ? { success: `Version ${result.activeVersion} was already recorded. No duplicate audit entry was created.` }
      : { success: `Recorded the completed Google OAuth secret rotation to version ${result.activeVersion}.` };
  } catch (error) {
    return friendlyError(error);
  }
}
