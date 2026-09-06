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
      <div className="max-w-lg mx-auto">
        <MembershipCard />
      </div>
    </main>
  );
}

function MembershipCard() {
  return (
    <div className="pt-6 border rounded-lg p-6">
      <h2 className="text-xl font-medium text-foreground mb-2">IDOC Annual Membership</h2>
      <p className="text-sm text-muted-foreground mb-4">One membership with full access for every professional classification.</p>
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
      <CheckoutForm label="Continue to payment" />
    </div>
  );
}
