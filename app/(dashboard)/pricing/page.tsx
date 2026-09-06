import { Check } from 'lucide-react';
import { CheckoutForm } from './checkout-form';

const MEMBERSHIP_FEE_EUR = 80;

export default function PricingPage() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-medium text-foreground mb-2 text-center">IDOC Membership</h1>
      <p className="text-muted-foreground text-center mb-10">
        €{MEMBERSHIP_FEE_EUR} per year — the same price for every professional classification.
      </p>
      <div className="grid md:grid-cols-2 gap-8 max-w-2xl mx-auto">
        <PricingCard
          badge="Default"
          description="Renews automatically each year. Cancel any time — access continues through your paid-through date."
          mode="subscription"
          title="Automatic renewal"
        />
        <PricingCard
          description="Pays for a single 12-month term. Renew manually whenever you're ready."
          mode="payment"
          title="One-time payment"
        />
      </div>
    </main>
  );
}

function PricingCard({ badge, description, mode, title }: {
  badge?: string; description: string; mode: 'payment' | 'subscription'; title: string;
}) {
  return (
    <div className="pt-6 border rounded-lg p-6">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xl font-medium text-foreground">{title}</h2>
        {badge && <span className="text-xs uppercase tracking-wide text-primary font-medium">{badge}</span>}
      </div>
      <p className="text-sm text-muted-foreground mb-4">{description}</p>
      <p className="text-4xl font-medium text-foreground mb-6">
        €{MEMBERSHIP_FEE_EUR} <span className="text-xl font-normal text-muted-foreground">/ year</span>
      </p>
      <ul className="space-y-2 mb-8 text-sm text-foreground">
        <li className="flex items-start">
          <Check className="h-4 w-4 text-primary mr-2 mt-0.5 flex-shrink-0" />
          Full member access for Judges, Stewards, and Veterinarians
        </li>
        <li className="flex items-start">
          <Check className="h-4 w-4 text-primary mr-2 mt-0.5 flex-shrink-0" />
          Restricted content and professional resources
        </li>
      </ul>
      <CheckoutForm label="Continue to payment" mode={mode} />
    </div>
  );
}
