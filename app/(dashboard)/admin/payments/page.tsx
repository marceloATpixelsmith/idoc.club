import Link from 'next/link';
import { getPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { MEMBERSHIP_STATUS_LABELS } from '@/lib/membership/entitlement';
import { ManualPaymentForm } from './manual-payment-form';
import { client } from '@/lib/db/drizzle';
import { MembershipRefundForm } from './refund-form';

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ profileId?: string }> }) {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const { profileId: profileIdParam } = await searchParams;
  const profileId = profileIdParam ? Number(profileIdParam) : null;
  const selected = profileId && Number.isInteger(profileId) ? await getPrivateMember(profileId) : null;
  const stripePayments = selected ? await client<{ amount_cents: number; currency: string; id: number; paid_at: Date | string; refund_status: string | null; source: string }[]>`select p.id,p.source,p.amount_cents,p.currency,p.paid_at,
    (select status from idoc.payment_refunds r where r.membership_payment_id=p.id order by r.requested_at desc limit 1) refund_status
    from idoc.payments p where p.profile_id=${selected.profile.id} and p.source in ('stripe_recurring','stripe_one_time') order by p.paid_at desc` : [];

  return <main className="flex-1 py-8 px-5 lg:px-8">
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
        <h3 className="mt-8 font-medium">Stripe payment history</h3>
        {stripePayments.length === 0 ? <p className="mt-2 text-sm">No refundable Stripe payments.</p> : stripePayments.map((payment) => <article className="mt-3 border-t pt-3" key={payment.id}>
          <p className="text-sm">{payment.source} · {new Intl.NumberFormat('en-IE', { currency: payment.currency, style: 'currency' }).format(payment.amount_cents / 100)} · {new Date(payment.paid_at).toLocaleDateString()}</p>
          {payment.refund_status === 'succeeded' ? <p className="text-sm font-medium">Refunded</p> : <MembershipRefundForm paymentId={String(payment.id)} profileId={String(selected.profile.id)} />}
        </article>)}
      </section>
    )}
  </main>;
}
