import { requireAccountAccess } from '@/lib/membership/data-access';
import { getOrganizationSettings } from '@/lib/organization/settings';
import { OrganizationSettingsForm } from './organization-settings-form';

export default async function OrganizationSettingsPage() {
  const actor = await requireAccountAccess('administration');
  const settings = await getOrganizationSettings(actor);
  return <main className="flex-1 p-5 sm:p-8"><h1 className="text-2xl font-semibold">Organization Settings</h1><p className="mt-2 text-sm text-muted-foreground">Manage the canonical public address and payment methods for future seminars.</p><OrganizationSettingsForm address={settings.address} methods={settings.paymentMethods} /></main>;
}
