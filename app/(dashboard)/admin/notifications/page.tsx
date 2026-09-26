import { redirect } from 'next/navigation';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

// Notification delivery history now lives in the Members page's per-member Sheet (Notifications
// tab) -- this route only exists so old links still land somewhere valid. See
// components/admin-navigation.tsx: the standalone nav item just told admins to go back to Members
// and search, so it's gone too (same reasoning as ../payments/page.tsx).
export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<{ profileId?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const { profileId } = await searchParams;
  redirect(profileId ? `/admin/members?profileId=${profileId}&tab=notifications` : '/admin/members');
}
