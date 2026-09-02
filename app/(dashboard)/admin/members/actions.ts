'use server';

import { redirect } from 'next/navigation';
import { updateMemberProfile, requireAccountAccess } from '@/lib/membership/data-access';
import { requireSuperAdmin } from '@/lib/membership/authorization';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { parseMemberProfileFormData } from '@/lib/membership/validation';
import { correctEntitlement, reinstateMembership, suspendMembership } from '@/lib/membership/status-actions';
import { grantApplicationRole, revokeApplicationRole } from '@/lib/membership/role-grants';
import { reinstateUserAccount, suspendUserAccount } from '@/lib/membership/account-suspension';
import { getSession } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';

async function requireCsrf(formData: FormData): Promise<void> {
  await requireCsrfToken(formData, (await getSession())?.sessionId ?? null);
}

type FormState = { error?: string; success?: string };

function friendlyError(error: unknown, fallback: string): FormState {
  if (error instanceof Error && error.name === 'ZodError') return { error: 'Review the highlighted fields.' };
  if (error instanceof Error && error.name === 'AuthorizationError') return { error: 'You are not authorized to make this change.' };
  if (error instanceof Error) return { error: error.message };
  return { error: fallback };
}

async function roleMutationNeedsStepUp(): Promise<FormState | boolean> {
  try {
    const actor = await requireAccountAccess('administration');
    requireSuperAdmin(actor);
    return (await requireFreshStepUp(actor, 'change-privileged-permissions', '/admin/members')).required;
  } catch (error) {
    return friendlyError(error, 'The role change could not be authorized safely.');
  }
}

export async function saveMemberProfileByAdminForm(_state: FormState, formData: FormData): Promise<FormState> {
  try { await requireCsrf(formData); } catch (error) { return friendlyError(error, 'The profile could not be updated safely.'); }
  const profileId = Number(formData.get('profileId'));
  const reason = String(formData.get('reason') ?? '');
  try {
    await updateMemberProfile(profileId, parseMemberProfileFormData(formData), { reason });
    return { success: 'Profile updated and audit entry recorded.' };
  } catch (error) {
    if (error instanceof Error && error.message === 'An administrative reason is required for this correction.') return { error: error.message };
    return friendlyError(error, 'The profile could not be updated safely.');
  }
}

export async function suspendMembershipForm(_state: FormState, formData: FormData): Promise<FormState> {
  try { await requireCsrf(formData); } catch (error) { return friendlyError(error, 'The membership could not be suspended.'); }
  const profileId = Number(formData.get('profileId'));
  try {
    const result = await suspendMembership(profileId, formData.get('reason'));
    if (result.stripeCancelError) {
      return { success: `Membership suspended. Warning: could not cancel the Stripe subscription (${result.stripeCancelError}) — cancel it manually.` };
    }
    return { success: result.stripeCancelled ? 'Membership suspended and the Stripe subscription cancelled.' : 'Membership suspended.' };
  } catch (error) {
    return friendlyError(error, 'The membership could not be suspended.');
  }
}

export async function reinstateMembershipForm(_state: FormState, formData: FormData): Promise<FormState> {
  try { await requireCsrf(formData); } catch (error) { return friendlyError(error, 'The membership could not be reinstated.'); }
  const profileId = Number(formData.get('profileId'));
  try {
    await reinstateMembership(profileId, { reason: formData.get('reason'), status: formData.get('status') });
    return { success: 'Membership reinstated.' };
  } catch (error) {
    return friendlyError(error, 'The membership could not be reinstated.');
  }
}

export async function correctEntitlementForm(_state: FormState, formData: FormData): Promise<FormState> {
  try { await requireCsrf(formData); } catch (error) { return friendlyError(error, 'The entitlement could not be corrected.'); }
  const profileId = Number(formData.get('profileId'));
  const validUntil = formData.get('validUntil');
  const status = formData.get('status');
  try {
    await correctEntitlement(profileId, {
      reason: formData.get('reason'),
      status: status ? String(status) : undefined,
      validUntil: validUntil ? String(validUntil) : undefined,
    });
    return { success: 'Entitlement corrected.' };
  } catch (error) {
    return friendlyError(error, 'The entitlement could not be corrected.');
  }
}

export async function suspendUserAccountForm(_state: FormState, formData: FormData): Promise<FormState> {
  try { await requireCsrf(formData); } catch (error) { return friendlyError(error, 'The account could not be suspended.'); }
  const userId = Number(formData.get('userId'));
  try {
    await suspendUserAccount(userId, formData.get('reason'));
    return { success: 'Account suspended. The user can no longer sign in.' };
  } catch (error) {
    return friendlyError(error, 'The account could not be suspended.');
  }
}

export async function reinstateUserAccountForm(_state: FormState, formData: FormData): Promise<FormState> {
  try { await requireCsrf(formData); } catch (error) { return friendlyError(error, 'The account could not be reinstated.'); }
  const userId = Number(formData.get('userId'));
  try {
    await reinstateUserAccount(userId, { accountState: formData.get('accountState'), reason: formData.get('reason') });
    return { success: 'Account reinstated.' };
  } catch (error) {
    return friendlyError(error, 'The account could not be reinstated.');
  }
}

export async function grantRoleForm(_state: FormState, formData: FormData): Promise<FormState> {
  try { await requireCsrf(formData); } catch (error) { return friendlyError(error, 'The role could not be granted.'); }
  const userId = Number(formData.get('userId'));
  const stepUp = await roleMutationNeedsStepUp();
  if (typeof stepUp !== 'boolean') return stepUp;
  if (stepUp) redirect('/mfa');
  try {
    await grantApplicationRole(userId, { reason: formData.get('reason'), role: formData.get('role') });
    return { success: 'Role granted.' };
  } catch (error) {
    return friendlyError(error, 'The role could not be granted.');
  }
}

export async function revokeRoleForm(_state: FormState, formData: FormData): Promise<FormState> {
  try { await requireCsrf(formData); } catch (error) { return friendlyError(error, 'The role could not be revoked.'); }
  const userId = Number(formData.get('userId'));
  const stepUp = await roleMutationNeedsStepUp();
  if (typeof stepUp !== 'boolean') return stepUp;
  if (stepUp) redirect('/mfa');
  try {
    await revokeApplicationRole(userId, { reason: formData.get('reason'), role: formData.get('role') });
    return { success: 'Role revoked.' };
  } catch (error) {
    return friendlyError(error, 'The role could not be revoked.');
  }
}
