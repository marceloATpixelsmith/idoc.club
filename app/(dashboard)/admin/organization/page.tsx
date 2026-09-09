import { requireAccountAccess } from '@/lib/membership/data-access';
import { getMembershipPerksForAdmin } from '@/lib/organization/membership-perks';
import { getOrganizationSettings } from '@/lib/organization/settings';
import { MembershipPerksForm } from './membership-perks-form';
import { OrganizationSettingsForm } from './organization-settings-form';

export default async function OrganizationSettingsPage() {
  const actor = await requireAccountAccess('administration');
  const [settings, perks] = await Promise.all([getOrganizationSettings(actor), getMembershipPerksForAdmin(actor)]);
  return <main className="flex-1 py-5 sm:py-8 px-5 lg:px-8"><h1 className="text-2xl font-semibold">Organization Settings</h1><p className="mt-2 text-sm text-muted-foreground">Manage the canonical public address and payment methods for future seminars.</p><OrganizationSettingsForm address={settings.address} methods={settings.paymentMethods} /><MembershipPerksForm perks={perks} /></main>;
}
