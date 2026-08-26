'use server';

import { redirect } from 'next/navigation';
import { updateMemberProfile } from '@/lib/membership/data-access';
import { parseMemberProfileFormData } from '@/lib/membership/validation';
import { correctEntitlement, reinstateMembership, suspendMembership } from '@/lib/membership/status-actions';
import { grantApplicationRole, revokeApplicationRole } from '@/lib/membership/role-grants';

type FormState = { error?: string; success?: string };

function friendlyError(error: unknown, fallback: string): FormState {
  if (error instanceof Error && error.name === 'ZodError') return { error: 'Review the highlighted fields.' };
  if (error instanceof Error && error.name === 'AuthorizationError') return { error: 'You are not authorized to make this change.' };
  if (error instanceof Error) return { error: error.message };
  return { error: fallback };
}

export async function saveMemberProfileByAdminForm(_state: FormState, formData: FormData): Promise<FormState> {
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
  const profileId = Number(formData.get('profileId'));
  try {
    await reinstateMembership(profileId, { reason: formData.get('reason'), status: formData.get('status') });
    return { success: 'Membership reinstated.' };
  } catch (error) {
    return friendlyError(error, 'The membership could not be reinstated.');
  }
}

export async function correctEntitlementForm(_state: FormState, formData: FormData): Promise<FormState> {
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

export async function grantRoleForm(_state: FormState, formData: FormData): Promise<FormState> {
  const userId = Number(formData.get('userId'));
  try {
    await grantApplicationRole(userId, { reason: formData.get('reason'), role: formData.get('role') });
    return { success: 'Role granted.' };
  } catch (error) {
    if (error instanceof Error && error.name === 'FreshStepUpRequiredError') redirect('/mfa');
    return friendlyError(error, 'The role could not be granted.');
  }
}

export async function revokeRoleForm(_state: FormState, formData: FormData): Promise<FormState> {
  const userId = Number(formData.get('userId'));
  try {
    await revokeApplicationRole(userId, { reason: formData.get('reason'), role: formData.get('role') });
    return { success: 'Role revoked.' };
  } catch (error) {
    if (error instanceof Error && error.name === 'FreshStepUpRequiredError') redirect('/mfa');
    return friendlyError(error, 'The role could not be revoked.');
  }
}
