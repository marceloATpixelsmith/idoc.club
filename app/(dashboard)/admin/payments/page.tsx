import Link from 'next/link';
import { getPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { MEMBERSHIP_STATUS_LABELS } from '@/lib/membership/entitlement';
import { ManualPaymentForm } from './manual-payment-form';

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ profileId?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const { profileId: profileIdParam } = await searchParams;
  const profileId = profileIdParam ? Number(profileIdParam) : null;
  const selected = profileId && Number.isInteger(profileId) ? await getPrivateMember(profileId) : null;

  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">Record a manual payment</h1>
    <Link className="mt-2 inline-block underline text-sm" href="/admin/members">← Search members</Link>
    {!selected && <p className="mt-4 text-sm text-foreground">Search for a member on the <Link className="text-primary underline underline-offset-4 hover:opacity-80" href="/admin/members">Members page</Link> to record a payment.</p>}
    {selected && (
      <section className="mt-8 max-w-md border rounded-lg p-4">
        <h2 className="font-medium text-foreground">{selected.profile.firstName} {selected.profile.lastName}</h2>
        <p className="mt-1 text-sm text-foreground">
          Status: {selected.entitlement ? (MEMBERSHIP_STATUS_LABELS[selected.entitlement.status] ?? selected.entitlement.status) : 'No membership on file'}
        </p>
        {selected.entitlement && <p className="text-sm text-foreground">Paid through: {selected.entitlement.validUntil}</p>}
        <ManualPaymentForm currentValidUntil={selected.entitlement?.validUntil ?? null} profileId={selected.profile.id} />
      </section>
    )}
  </main>;
}
