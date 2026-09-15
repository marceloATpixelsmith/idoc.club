import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getOwnPrivateMember, hasOwnBillingAccount, requireAccountAccess } from '@/lib/membership/data-access';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { getOwnPaymentMethodSummary } from '@/lib/payments/stripe';
import { getUser } from '@/lib/db/queries';
import { ManagePaymentMethodButton } from './manage-payment-method-button';

function brandLabel(brand: string): string {
  return brand.length > 0 ? brand.charAt(0).toUpperCase() + brand.slice(1) : brand;
}

export default async function PaymentMethodPage() {
  const user = await getUser();
  if (!user || user.accountState === 'onboarding') redirect('/dashboard');
  const actor = await requireAccountAccess('profile');
  const privileged = isPrivilegedActor(actor);
  // Same paywall convention every other dashboard sub-page follows (see security/page.tsx): a
  // non-entitled ordinary member is bounced back to My Membership, never left on a sub-page.
  if (!privileged) {
    const member = await getOwnPrivateMember();
    if (member && !isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))) redirect('/dashboard');
  }
  const canManageBilling = await hasOwnBillingAccount();
  if (!canManageBilling) redirect('/dashboard');
  const summary = await getOwnPaymentMethodSummary();

  return (
    <main className="flex-1 py-4 lg:py-8 px-5 lg:px-8">
      <Link className="text-sm text-muted-foreground underline" href="/dashboard">← Back to My Membership</Link>
      <h1 className="mt-3 text-2xl font-semibold">Payment Method</h1>

      <section className="mt-6 max-w-md space-y-4 rounded-lg border p-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Card on file</p>
          {summary ? (
            <p className="mt-1 text-sm text-foreground">
              {brandLabel(summary.brand)} ending in {summary.last4} — expires {String(summary.expMonth).padStart(2, '0')}/{summary.expYear}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No payment method on file yet.</p>
          )}
        </div>
        <ManagePaymentMethodButton />
      </section>
    </main>
  );
}
