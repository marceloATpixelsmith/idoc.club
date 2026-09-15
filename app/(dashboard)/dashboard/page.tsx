import { redirect } from 'next/navigation';
import { Gavel, Flag, Stethoscope } from 'lucide-react';
import { getOwnPrivateMember, hasOwnBillingAccount, listOwnPaymentHistory, requireAccountAccess } from '@/lib/membership/data-access';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { MEMBERSHIP_STATUS_LABELS, isEntitled, renewalMode } from '@/lib/membership/entitlement';
import { PAYMENT_SOURCE_LABELS } from '@/lib/payments/pricing';
import { getUser } from '@/lib/db/queries';
import { parseMemberClassification } from '@/lib/membership/classification';
import { OnboardingWizard } from '@/app/(dashboard)/onboarding/onboarding-wizard';
import { MembershipCard } from './membership-card';
import { getOwnRenewalPreference } from '@/lib/payments/renewal-preferences';

const RENEW_WINDOW_DAYS = 15;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// Every member-type caption, without repeating the renewal date itself -- that's shown once, in
// the card's own "Renewal Date" line, right above.
function renewalCaption(mode: ReturnType<typeof renewalMode>): string | null {
  switch (mode) {
    case 'auto_renew': return 'Renews automatically.';
    case 'cancels_at_period_end': return 'Auto-renewal is cancelled. Your membership stays active through the renewal date above.';
    case 'manual': return 'Manual renewal — renew via the pricing page before the renewal date above.';
    default: return null;
  }
}

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

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ membership?: string }> }) {
  // 'profile', not 'member': an expired or under-review member must still be able to reach this
  // page to see their status and pay/renew, not just currently-entitled members (docs/02's
  // "limited expired-account view").
  const user = await getUser();
  const onboarding = user?.accountState === 'onboarding';
  const actor = await requireAccountAccess(onboarding ? 'onboarding' : 'profile');
  const privileged = isPrivilegedActor(actor);
  const { membership } = await searchParams;

  if (onboarding) {
    return (
      <main className="flex-1 py-4 lg:py-8 px-5 lg:px-8">
        <OnboardingWizard initialClassification={parseMemberClassification(membership)} />
      </main>
    );
  }

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
    redirect('/dashboard');
  }

  const { entitlement, roles, subscription } = member;
  const today = new Date().toISOString().slice(0, 10);
  const entitled = isEntitled(entitlement, today);

  if (!entitled && !privileged) {
    redirect('/pricing');
  }

  const mode = renewalMode(subscription, entitlement);
  const showRenew = Boolean(entitlement) && daysUntil(entitlement!.validUntil, today) <= RENEW_WINDOW_DAYS;
  const [history, renewalPreference] = await Promise.all([listOwnPaymentHistory(), getOwnRenewalPreference()]);
  const { icon: typeIcon, label: typeLabel } = classificationDisplay(roles);
  // The one date worth leading with: while an open subscription is actually going to bill again,
  // that's Stripe's own currentPeriodEnd, not the paid-through date -- an early renewal (docs/02 §5)
  // or an administrator's Extend Expiration Date correction can leave the two different.
  const renewalDate = entitlement ? (mode === 'auto_renew' ? (subscription?.currentPeriodEnd ?? entitlement.validUntil) : entitlement.validUntil) : null;

  return (
    <main className="flex-1 py-4 lg:py-8 px-5 lg:px-8">
      <h1 className="text-2xl font-semibold">My Membership</h1>
      <p className="mt-3">Welcome, {member.profile.firstName} {member.profile.lastName}.</p>

      <MembershipCard
        canManageBilling={canManageBilling}
        paidThroughDate={entitlement?.validUntil ?? null}
        preference={renewalPreference}
        recurring={mode === 'auto_renew' || mode === 'cancels_at_period_end'}
        renewalCaption={entitlement ? renewalCaption(mode) : null}
        renewalDate={renewalDate}
        showRenew={showRenew}
        statusLabel={entitlement ? (MEMBERSHIP_STATUS_LABELS[entitlement.status] ?? entitlement.status) : 'No membership record on file'}
        typeIcon={typeIcon}
        typeLabel={typeLabel}
      />

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
