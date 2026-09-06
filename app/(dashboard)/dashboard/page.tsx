import Link from 'next/link';
import { redirect } from 'next/navigation';
import { manageBillingAction } from '@/lib/payments/actions';
import { getOwnPrivateMember, hasOwnBillingAccount, listOwnPaymentHistory, requireAccountAccess } from '@/lib/membership/data-access';
import { CsrfField } from '@/components/security/csrf-field';
import { MEMBERSHIP_STATUS_LABELS, isEntitled, renewalMode } from '@/lib/membership/entitlement';
import { PAYMENT_SOURCE_LABELS } from '@/lib/payments/pricing';
import { Button } from '@/components/ui/button';

const RENEW_WINDOW_DAYS = 15;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function renewalMessage(mode: ReturnType<typeof renewalMode>, subscriptionCurrentPeriodEnd: string | undefined, validUntil: string | undefined) {
  switch (mode) {
    case 'auto_renew': return `Renews automatically around ${subscriptionCurrentPeriodEnd}.`;
    case 'cancels_at_period_end': return `Auto-renewal is cancelled. Your membership stays active through ${validUntil}.`;
    case 'manual': return `Manual renewal — renew via the pricing page before ${validUntil}.`;
    default: return null;
  }
}

/** "Judge + Steward" is the classification-picker's own option label (profile-form.tsx); the
 * membership summary uses the more compact form the member actually asked for here. */
function classificationLabel(roles: { roleType: string }[]): string {
  const types = new Set(roles.map(({ roleType }) => roleType));
  if (types.has('judge') && types.has('steward')) return 'J&S Combo';
  if (types.has('judge')) return 'Judge';
  if (types.has('steward')) return 'Steward';
  return 'Veterinarian';
}

function daysUntil(validUntil: string, today: string): number {
  return Math.round((new Date(`${validUntil}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / MILLISECONDS_PER_DAY);
}

export default async function DashboardPage() {
  // 'profile', not 'member': an expired or under-review member must still be able to reach this
  // page to see their status and pay/renew, not just currently-entitled members (docs/02's
  // "limited expired-account view").
  await requireAccountAccess('profile');
  const [member, canManageBilling] = await Promise.all([getOwnPrivateMember(), hasOwnBillingAccount()]);
  if (!member) redirect('/onboarding');
  const { entitlement, roles, subscription } = member;
  const today = new Date().toISOString().slice(0, 10);
  const entitled = isEntitled(entitlement, today);

  if (!entitled) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-semibold">Pay for your IDOC membership</h1>
        <p className="max-w-md text-gray-600">
          Your account isn&apos;t an active member yet. Complete payment to unlock your profile, security settings, and the rest of your dashboard.
        </p>
        <Link href="/pricing"><Button size="lg">Pay for membership</Button></Link>
      </main>
    );
  }

  const mode = renewalMode(subscription, entitlement);
  const message = renewalMessage(mode, subscription?.currentPeriodEnd, entitlement?.validUntil);
  const showRenew = Boolean(entitlement) && daysUntil(entitlement!.validUntil, today) <= RENEW_WINDOW_DAYS;
  const history = await listOwnPaymentHistory();

  return (
    <main className="flex-1 p-4 lg:p-8">
      <h1 className="text-2xl font-semibold">My Membership</h1>
      <p className="mt-3">Welcome, {member.profile.firstName} {member.profile.lastName}.</p>

      <section className="mt-6 max-w-md rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-700">Type: <span className="font-medium text-gray-900">{classificationLabel(roles)}</span></p>
          <Link className="text-sm underline" href="/dashboard/profile">Change type</Link>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-sm text-gray-700">Status: {MEMBERSHIP_STATUS_LABELS[entitlement!.status] ?? entitlement!.status}</p>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="text-sm text-gray-700">Expires: {entitlement!.validUntil}</p>
          {showRenew ? <Link href="/pricing"><Button size="sm">Renew</Button></Link> : null}
        </div>
        {message ? <p className="mt-1 text-sm text-gray-700">{message}</p> : null}
        {canManageBilling && (
          <form action={manageBillingAction}>
            <CsrfField />
            <button type="submit" className="mt-2 block text-sm underline">Manage payment method</button>
          </form>
        )}
      </section>

      <section className="mt-6 max-w-2xl">
        <h2 className="font-medium text-gray-900">Payment history</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left">
                <th className="p-2">Date</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td className="p-2 text-gray-500" colSpan={3}>No payments on file yet.</td></tr>
              )}
              {history.map((payment) => (
                <tr key={payment.id} className="border-b">
                  <td className="p-2">{payment.paidAt.toISOString().slice(0, 10)}</td>
                  <td className="p-2">{(payment.amountCents / 100).toFixed(2)} {payment.currency}</td>
                  <td className="p-2">{PAYMENT_SOURCE_LABELS[payment.source] ?? payment.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
