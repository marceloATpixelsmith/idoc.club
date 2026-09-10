import { MembershipPerksList } from '@/components/membership/membership-perks-list';
import { getMembershipPerks } from '@/lib/organization/membership-perks';
import { CheckoutForm } from './checkout-form';

const MEMBERSHIP_FEE_EUR = 80;

export default async function PricingPage() {
  const perks = await getMembershipPerks();
  return (
    <main className="max-w-7xl mx-auto px-5 lg:px-8 py-12">
      <h1 className="text-3xl font-medium text-foreground mb-2 text-center">IDOC Membership</h1>
      <p className="text-muted-foreground text-center mb-10">
        €{MEMBERSHIP_FEE_EUR} per year — the same price for every professional classification.
      </p>
      <div className="max-w-lg mx-auto">
        <MembershipCard perks={perks} />
      </div>
    </main>
  );
}

function MembershipCard({ perks }: { perks: Awaited<ReturnType<typeof getMembershipPerks>> }) {
  return (
    <div className="card-midnight flex flex-col p-8">
      <h2 className="text-3xl">IDOC Annual Membership</h2>
      <p className="mt-2 text-sm uppercase tracking-[0.16em] text-gold">€{MEMBERSHIP_FEE_EUR} / year</p>
      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">One membership with full access for every professional classification.</p>
      <MembershipPerksList className="mt-7 space-y-3 text-sm" perks={perks} />
      <div className="mt-8">
        <CheckoutForm label="Pay" />
      </div>
    </div>
  );
}
