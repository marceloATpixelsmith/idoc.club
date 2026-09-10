'use server';

import { revalidatePath } from 'next/cache';

import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { updateMembershipPerks } from '@/lib/organization/membership-perks';
import { updateOrganizationSettings } from '@/lib/organization/settings';
import { requireCsrfToken } from '@/lib/security/csrf';

export type OrganizationSettingsState = { error?: string; success?: string };
export type MembershipPerksState = { error?: string; success?: string };

export async function saveOrganizationSettings(_state: OrganizationSettingsState, formData: FormData): Promise<OrganizationSettingsState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    await updateOrganizationSettings(actor, {
      address: Object.fromEntries(['address1', 'address2', 'city', 'stateProvince', 'postalCode', 'country'].map((key) => [key, formData.get(key)])),
      bankEnabled: formData.get('bankEnabled') === 'on',
      bankInstructions: String(formData.get('bankInstructions') ?? ''),
      cashEnabled: formData.get('cashEnabled') === 'on',
    });
    revalidatePath('/', 'layout');
    revalidatePath('/contact');
    return { success: 'Organization settings saved.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Organization settings could not be saved.' };
  }
}

export async function saveMembershipPerks(_state: MembershipPerksState, formData: FormData): Promise<MembershipPerksState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    await updateMembershipPerks(actor, formData.getAll('perk').map(String));
    revalidatePath('/', 'layout');
    revalidatePath('/membership');
    revalidatePath('/pricing');
    return { success: 'Membership perks saved.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Membership perks could not be saved.' };
  }
}
