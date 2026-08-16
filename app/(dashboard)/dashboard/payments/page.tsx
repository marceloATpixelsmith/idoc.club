import { listOwnPaymentHistory, requireAccountAccess } from '@/lib/membership/data-access';
import { PAYMENT_SOURCE_LABELS } from '@/lib/payments/pricing';

export default async function DashboardPaymentsPage() {
  await requireAccountAccess('profile');
  const history = await listOwnPaymentHistory();

  return <main className="flex-1 p-8">
    <h1 className="text-2xl font-semibold">Payment history</h1>
    <section className="mt-6 overflow-x-auto">
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
    </section>
  </main>;
}
