import { Banknote, CreditCard, Landmark, WalletCards } from 'lucide-react';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank Transfer',
  cash_event: 'Cash at the Event',
  online_stripe: 'Online / Stripe',
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method.replaceAll('_', ' ');
}

export function PaymentMethodIcon({ className = 'size-4 text-gold', method }: { className?: string; method: string }) {
  const Icon = method === 'online_stripe'
    ? CreditCard
    : method === 'bank_transfer'
      ? Landmark
      : method === 'cash_event'
        ? Banknote
        : WalletCards;

  return <Icon aria-label={paymentMethodLabel(method)} className={className} role="img" />;
}
