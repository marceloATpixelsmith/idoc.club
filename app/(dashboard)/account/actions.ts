'use server';

import { getOwnPrivateMember, updateMemberProfile } from '@/lib/membership/data-access';

export async function saveOwnMemberProfile(input: unknown) {
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
  const classification = String(formData.get('classification') ?? '');
  const official = {
    feiId: formData.get('feiId'), idocRegion: formData.get('idocRegion'),
    nationalFederationCountryCode: formData.get('nationalFederationCountryCode'),
  };
  const roles = classification === 'veterinarian' ? [{ roleType: 'veterinarian' }] : [
    ...(classification === 'judge' || classification === 'judge_steward' ? [{ ...official, isTechnicalDelegate: formData.get('isTechnicalDelegate') === 'yes', officialStatus: formData.get('judgeStatus'), roleType: 'judge' }] : []),
    ...(classification === 'steward' || classification === 'judge_steward' ? [{ ...official, officialStatus: formData.get('stewardStatus'), roleType: 'steward' }] : []),
  ];
  return saveOwnMemberProfile({ address1: formData.get('address1'), address2: formData.get('address2'), city: formData.get('city'), countryCode: formData.get('countryCode'), firstName: formData.get('firstName'), lastName: formData.get('lastName'), postalCode: formData.get('postalCode'), roles, stateProvince: formData.get('stateProvince') });
}
