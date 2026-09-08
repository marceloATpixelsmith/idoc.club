import { notFound } from 'next/navigation';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireSuperAdmin } from '@/lib/membership/authorization';

export default async function OrganizationSettingsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAccountAccess('administration');
  try {
    requireSuperAdmin(actor);
  } catch {
    notFound();
  }
  return children;
}
