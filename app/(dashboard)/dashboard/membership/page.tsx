import { redirect } from 'next/navigation';
import { Gavel, Flag, Stethoscope } from 'lucide-react';
import { getOwnPrivateMember, hasOwnBillingAccount, listOwnPaymentHistory, requireAccountAccess } from '@/lib/membership/data-access';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { MEMBERSHIP_STATUS_LABELS, isEntitled, renewalMode } from '@/lib/membership/entitlement';
import { MEMBERSHIP_FEE_CENTS, PAYMENT_SOURCE_LABELS } from '@/lib/payments/pricing';
import { getOwnPaymentMethodSummary } from '@/lib/payments/stripe';
import { MembershipCard } from './membership-card';
import { PaymentMethodCard } from './payment-method-card';
import { getOwnRenewalPreference } from '@/lib/payments/renewal-preferences';
import { getAccountStateUser } from '@/lib/db/queries';
import { MembershipPerksList } from '@/components/membership/membership-perks-list';
import { getMembershipPerks } from '@/lib/organization/membership-perks';
import { CheckoutForm } from './checkout-form';

const RENEW_WINDOW_DAYS = 15;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** "Judge + Steward" is the classification-picker's own option label (profile-form.tsx); the
 * membership summary uses the more compact form the member actually asked for here. Each
 * classification gets its own gold icon so the member's type reads at a glance. */
function classificationDisplay(roles: { roleType: string }[]): { icon: React.ReactNode; label: string } {
  const types = new Set(roles.map(({ roleType }) => roleType));
  if (types.has('judge') && types.has('steward')) {
    return { icon: <span className="inline-flex items-center gap-1"><Gavel className="size-7" aria-hidden="true" /><Flag className="size-7" aria-hidden="true" /></span>, label: 'J&S Combo' };
  }
  if (types.has('judge')) return { icon: <Gavel className="size-7" aria-hidden="true" />, label: 'Judge' };
  if (types.has('steward')) return { icon: <Flag className="size-7" aria-hidden="true" />, label: 'Steward' };
  return { icon: <Stethoscope className="size-7" aria-hidden="true" />, label: 'Veterinarian' };
}

function daysUntil(validUntil: string, today: string): number {
  return Math.round((new Date(`${validUntil}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / MILLISECONDS_PER_DAY);
}

/** '/dashboard' is the account's onboarding gate and normally routes an unfinished account there
 * instead of here (see ../page.tsx) -- but a direct deep link can still land here first, so this
 * page must check for itself rather than trust that routing (AUTH-AUTHZ-011; same bug class as
 * AUTH-AUTHZ-009/010: requireAccountAccess('profile') throws AuthorizationError for an
 * onboarding-state account, which left uncaught crashed into Next.js's generic error boundary
 * instead of redirecting). */
function MembershipCheckoutPanel({ perks }: { perks: Awaited<ReturnType<typeof getMembershipPerks>> }) {
  return (
    <section className="card-midnight mt-6 flex max-w-lg flex-col p-8">
      <h2 className="text-2xl font-semibold text-foreground">IDOC Annual Membership</h2>
      <p className="mt-2 text-sm uppercase tracking-[0.16em] text-gold">€{MEMBERSHIP_FEE_CENTS / 100} / year</p>
      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
        One membership with full access for every professional classification.
      </p>
      <MembershipPerksList className="mt-7 space-y-3 text-sm" perks={perks} />
      <div className="mt-8">
        <CheckoutForm label="Pay" />
      </div>
    </section>
  );
}

export default async function DashboardMembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ renew?: string }>;
}) {
  const user = await getAccountStateUser();
  if (!user || user.accountState === 'onboarding') redirect('/dashboard');
  // 'profile', not 'member': an expired or under-review member must still be able to reach this
  // page to see their status and pay/renew, not just currently-entitled members (docs/02's
  // "limited expired-account view").
  const actor = await requireAccountAccess('profile');
  const privileged = isPrivilegedActor(actor);

  const [member, canManageBilling] = await Promise.all([getOwnPrivateMember(), hasOwnBillingAccount()]);

  if (!member) {
    // An administrator/super_admin is never a member and must never be pushed into onboarding just
    // for visiting their own dashboard -- only an ordinary account without a profile yet needs that.
    if (privileged) {
      return (
        <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <h1 className="text-2xl font-semibold">My Membership</h1>
          <p className="max-w-md text-muted-foreground">You have no member profile. This page is for members; as an administrator you are never gated by it.</p>
        </main>
      );
    }
    // Routes back through the onboarding gate, in case a fresh read there now resolves this
    // account's state differently (e.g. profile creation just committed after a stale read here).
    redirect('/dashboard');
  }

  const { entitlement, roles, subscription } = member;
  const today = new Date().toISOString().slice(0, 10);
  const entitled = isEntitled(entitlement, today);

  if (!entitled && !privileged) {
    const perks = await getMembershipPerks();
    return (
      <main className="flex-1 py-4 lg:py-8 px-5 lg:px-8">
        <h1 className="text-2xl font-semibold">My Membership</h1>
        <p className="mt-3 text-muted-foreground">
          Your membership is not currently active. Pay the annual fee below to activate or renew it.
        </p>
        <MembershipCheckoutPanel perks={perks} />
      </main>
    );
  }

  const mode = renewalMode(subscription, entitlement);
  const showRenew = Boolean(entitlement) && daysUntil(entitlement!.validUntil, today) <= RENEW_WINDOW_DAYS;
  const { renew } = await searchParams;
  const renewalPerks = showRenew && renew === '1' ? await getMembershipPerks() : null;
  const [history, renewalPreference, paymentMethodSummary] = await Promise.all([
    listOwnPaymentHistory(),
    getOwnRenewalPreference(),
    // A Stripe lookup failure here must never take down the rest of My Membership (status,
    // renewal controls, cancellation, payment history) -- it only means the Payment Method box
    // can't show the card on file right now; the member can still retry via its own button.
    canManageBilling ? getOwnPaymentMethodSummary().catch(() => 'unavailable' as const) : Promise.resolve(null),
  ]);
  const { icon: typeIcon, label: typeLabel } = classificationDisplay(roles);

  return (
    <main className="flex-1 py-4 lg:py-8 px-5 lg:px-8">
      <h1 className="text-2xl font-semibold">My Membership</h1>
      <p className="mt-3">Welcome, {member.profile.firstName} {member.profile.lastName}.</p>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <MembershipCard
          preference={renewalPreference}
          recurring={mode === 'auto_renew' || mode === 'cancels_at_period_end'}
          renewalDate={entitlement?.validUntil ?? null}
          showRenew={showRenew}
          statusLabel={entitlement ? (MEMBERSHIP_STATUS_LABELS[entitlement.status] ?? entitlement.status) : 'No membership record on file'}
          typeIcon={typeIcon}
          typeLabel={typeLabel}
        />
        {canManageBilling ? <PaymentMethodCard summary={paymentMethodSummary} /> : null}
      </div>

      {renewalPerks ? (
        <div id="renew">
          <MembershipCheckoutPanel perks={renewalPerks} />
        </div>
      ) : null}

      <section className="mt-6 max-w-2xl">
        <h2 className="font-medium text-foreground">Payment history</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr className="border-b bg-surface text-left">
                <th className="p-2">Date</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td className="p-2 text-muted-foreground" colSpan={3}>No payments on file yet.</td></tr>
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
