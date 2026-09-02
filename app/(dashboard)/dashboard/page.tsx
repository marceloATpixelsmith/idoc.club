import Link from 'next/link';
import { redirect } from 'next/navigation';
import { manageBillingAction } from '@/lib/payments/actions';
import { getOwnPrivateMember, hasOwnBillingAccount, requireAccountAccess } from '@/lib/membership/data-access';
import { CsrfField } from '@/components/security/csrf-field';
import { MEMBERSHIP_STATUS_LABELS, renewalMode } from '@/lib/membership/entitlement';

function renewalMessage(mode: ReturnType<typeof renewalMode>, subscriptionCurrentPeriodEnd: string | undefined, validUntil: string | undefined) {
  switch (mode) {
    case 'auto_renew': return `Renews automatically around ${subscriptionCurrentPeriodEnd}.`;
    case 'cancels_at_period_end': return `Auto-renewal is cancelled. Your membership stays active through ${validUntil}.`;
    case 'manual': return `Manual renewal — renew via the pricing page before ${validUntil}.`;
    default: return null;
  }
}

export default async function DashboardPage() {
  // 'profile', not 'member': an expired or under-review member must still be able to reach this
  // page to see their status and renew, not just currently-entitled members (docs/02's "limited
  // expired-account view").
  await requireAccountAccess('profile');
  const [member, canManageBilling] = await Promise.all([getOwnPrivateMember(), hasOwnBillingAccount()]);
  if (!member) redirect('/onboarding');
  const { entitlement, subscription } = member;
  const mode = renewalMode(subscription, entitlement);
  const message = renewalMessage(mode, subscription?.currentPeriodEnd, entitlement?.validUntil);
  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">IDOC member account</h1>
    <p className="mt-3">Welcome, {member.profile.firstName} {member.profile.lastName}.</p>
    <p className="mt-2">Your professional profile contains {member.roles.length} active classification record(s).</p>
    <section className="mt-6 border rounded-lg p-4 max-w-md">
      <h2 className="font-medium text-gray-900">Membership</h2>
      {entitlement ? (
        <>
          <p className="mt-2 text-sm text-gray-700">Status: {MEMBERSHIP_STATUS_LABELS[entitlement.status] ?? entitlement.status}</p>
          <p className="mt-1 text-sm text-gray-700">Paid through: {entitlement.validUntil}</p>
          {message && <p className="mt-1 text-sm text-gray-700">{message}</p>}
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-700">No membership on file yet.</p>
      )}
      <Link className="mt-3 inline-block underline text-sm" href="/pricing">
        {entitlement ? 'Renew or manage payment' : 'Start your membership'}
      </Link>
      {entitlement && canManageBilling && (
        <form action={manageBillingAction}>
          <CsrfField />
          <button type="submit" className="mt-2 block text-sm underline">Manage payment method</button>
        </form>
      )}
    </section>
    <Link className="mt-6 inline-block underline" href="/dashboard/profile">Edit your profile</Link>
    <Link className="mt-2 block underline" href="/dashboard/payments">Payment history</Link>
  </main>;
}
