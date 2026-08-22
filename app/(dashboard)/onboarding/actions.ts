'use server';

import { redirect } from 'next/navigation';
import { getUser } from '@/lib/db/queries';
import { createOwnMemberProfile } from '@/lib/membership/data-access';
import { parseOnboardingConsentFormData } from '@/lib/membership/validation';
import { subscribeToMarketingList } from '@/lib/notifications/mailchimp-marketing';

export async function completeOnboarding(_state: { error?: string }, formData: FormData) {
  const kind = String(formData.get('classification'));
  const shared = {
    feiId: formData.get('feiId'), idocRegion: formData.get('idocRegion'),
    nationalFederationCountryCode: formData.get('nationalFederationCountryCode'),
  };
  const roles = [];
  if (kind === 'judge' || kind === 'judge_steward') roles.push({ ...shared, isTechnicalDelegate: formData.get('isTechnicalDelegate') === 'yes', officialStatuses: formData.getAll('judgeStatus'), roleType: 'judge' });
  if (kind === 'steward' || kind === 'judge_steward') roles.push({ ...shared, officialStatuses: formData.getAll('stewardStatus'), roleType: 'steward' });
  if (kind === 'veterinarian') roles.push({ roleType: 'veterinarian' });
  const consent = parseOnboardingConsentFormData(formData);
  let profile: { keepUpdatedOptIn: boolean };
  try {
    profile = await createOwnMemberProfile({
      address1: formData.get('address1'), address2: formData.get('address2'), city: formData.get('city'),
      countryCode: formData.get('countryCode'), firstName: formData.get('firstName'), lastName: formData.get('lastName'),
      postalCode: formData.get('postalCode'), roles, stateProvince: formData.get('stateProvince'),
    }, consent);
  } catch {
    return { error: 'Review all required fields. A profile can only be created once.' };
  }
  if (profile.keepUpdatedOptIn) {
    const user = await getUser();
    if (user) await subscribeToMarketingList(user.email);
  }
  redirect('/dashboard');
}
