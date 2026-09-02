'use server';

import { redirect } from 'next/navigation';
import { createOwnMemberProfile } from '@/lib/membership/data-access';
import { rawCanonicalSessionId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';

export async function completeOnboarding(_state: { error?: string }, formData: FormData) {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId());
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Your session security check failed.' };
  }
  const kind = String(formData.get('classification'));
  const shared = {
    feiId: formData.get('feiId'), idocRegion: formData.get('idocRegion'),
    nationalFederationCountryCode: formData.get('nationalFederationCountryCode'),
  };
  const roles = [];
  if (kind === 'judge' || kind === 'judge_steward') roles.push({ ...shared, isTechnicalDelegate: formData.get('isTechnicalDelegate') === 'yes', officialStatuses: formData.getAll('judgeStatus'), roleType: 'judge' });
  if (kind === 'steward' || kind === 'judge_steward') roles.push({ ...shared, officialStatuses: formData.getAll('stewardStatus'), roleType: 'steward' });
  if (kind === 'veterinarian') roles.push({ roleType: 'veterinarian' });
  try {
    await createOwnMemberProfile({
      address1: formData.get('address1'), address2: formData.get('address2'), city: formData.get('city'),
      countryCode: formData.get('countryCode'), firstName: formData.get('firstName'), lastName: formData.get('lastName'),
      postalCode: formData.get('postalCode'), roles, stateProvince: formData.get('stateProvince'),
    }, {
      keepUpdated: formData.get('keepUpdated') === 'on',
      privacyAccepted: formData.get('privacyAccepted') === 'on',
      termsAccepted: formData.get('termsAccepted') === 'on',
    });
  } catch {
    return { error: 'Review all required fields. A profile can only be created once.' };
  }
  redirect('/dashboard');
}
