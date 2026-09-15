import type { PaymentMethodSummary } from '@/lib/payments/stripe';
import { ManagePaymentMethodButton } from './manage-payment-method-button';

function brandLabel(brand: string): string {
  return brand.length > 0 ? brand.charAt(0).toUpperCase() + brand.slice(1) : brand;
}

export function PaymentMethodCard({ summary }: { summary: PaymentMethodSummary | null }) {
  return (
    <section className="mt-6 max-w-md rounded-lg border p-5">
      <h2 className="text-lg font-semibold text-foreground">Payment Method</h2>

      <div className="mt-4 text-sm">
        <p className="font-semibold text-foreground">Card on file</p>
        {summary ? (
          <p className="mt-1 text-foreground">
            {brandLabel(summary.brand)} ending in {summary.last4} — expires {String(summary.expMonth).padStart(2, '0')}/{summary.expYear}
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">No payment method on file yet.</p>
        )}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <ManagePaymentMethodButton />
      </div>
    </section>
  );
}
