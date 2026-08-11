'use server';

import { redirect } from 'next/navigation';
import { createOwnMemberProfile } from '@/lib/membership/data-access';

export async function completeOnboarding(_state: { error?: string }, formData: FormData) {
  const kind = String(formData.get('classification'));
  const shared = {
    feiId: formData.get('feiId'), idocRegion: formData.get('idocRegion'),
    nationalFederationCountryCode: formData.get('nationalFederationCountryCode'),
  };
  const roles = [];
  if (kind === 'judge' || kind === 'judge_steward') roles.push({ ...shared, isTechnicalDelegate: formData.get('isTechnicalDelegate') === 'yes', officialStatus: formData.get('judgeStatus'), roleType: 'judge' });
  if (kind === 'steward' || kind === 'judge_steward') roles.push({ ...shared, officialStatus: formData.get('stewardStatus'), roleType: 'steward' });
  if (kind === 'veterinarian') roles.push({ roleType: 'veterinarian' });
  try {
    await createOwnMemberProfile({
      address1: formData.get('address1'), address2: formData.get('address2'), city: formData.get('city'),
      countryCode: formData.get('countryCode'), firstName: formData.get('firstName'), lastName: formData.get('lastName'),
      postalCode: formData.get('postalCode'), roles, stateProvince: formData.get('stateProvince'),
    });
  } catch {
    return { error: 'Review all required fields. A profile can only be created once.' };
  }
  redirect('/dashboard');
}
