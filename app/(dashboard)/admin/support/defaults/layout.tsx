import { notFound } from 'next/navigation';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';

export default async function SupportDefaultsLayout({ children }: { children: React.ReactNode }) {
  try {
    const actor = await requireAccountAccess('administration');
    requireSuperAdmin(actor);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  return children;
}
