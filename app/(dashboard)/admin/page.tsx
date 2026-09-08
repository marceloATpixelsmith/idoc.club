import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';

export default async function AdminPage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return <main className="flex-1 py-8 px-5 lg:px-8">
    <p className="eyebrow">Administration</p>
    <h1 className="mt-2 font-display text-3xl">Admin Dashboard</h1>
    <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Use the navigation to manage the IDOC functions available to your assigned administrator role.</p>
  </main>;
}
