'use client';

import { AdminReadOnlyTable } from '@/components/admin/admin-read-only-table';
import type { TablePreferenceState } from '@/lib/admin/table-preferences';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { formatTableDate } from '@/lib/format';
import { MembershipRefundForm } from './refund-form';

type StripePayment = { amount_cents: number; currency: string; id: number; paid_at: Date | string; refund_status: string | null; source: string };

const SOURCE_LABELS: Record<string, string> = {
    bank_transfer: 'Bank transfer',
    cash: 'Cash',
    complimentary: 'Complimentary grant',
    stripe_manual: 'Stripe (manual)',
    stripe_one_time: 'Stripe one-time',
    stripe_recurring: 'Stripe recurring',
};

function RefundAction({ onSuccess, payment, profileId }: { onSuccess: () => void; payment: StripePayment; profileId: string })
    {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button aria-label={`Refund payment from ${formatTableDate(payment.paid_at)}`} size="icon" type="button" variant="ghost">
                    <Undo2 aria-hidden="true" className="size-4" />
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Refund membership payment</DialogTitle>
                    <DialogDescription>
                        Approve a full refund of {new Intl.NumberFormat('en-IE', { currency: payment.currency, style: 'currency' }).format(payment.amount_cents / 100)} paid on {formatTableDate(payment.paid_at)}. A reason is required. The original payment history will be preserved.
                    </DialogDescription>
                </DialogHeader>
                <MembershipRefundForm onSuccess={onSuccess} paymentId={String(payment.id)} profileId={profileId} />
            </DialogContent>
        </Dialog>
    );
    }

const COLUMNS = [
    { id: 'date', label: 'Date' },
    { id: 'amount', label: 'Amount' },
    { id: 'source', label: 'Source' },
    { id: 'status', label: 'Status' },
];

export function MemberPaymentsTable({ initialPreferences, loading, onSuccess, payments, profileId }: { initialPreferences?: TablePreferenceState | null; loading?: boolean; onSuccess: () => void; payments: StripePayment[]; profileId: string })
    {
    const rows = payments.map((payment) => ({
        id: String(payment.id),
        date: new Date(payment.paid_at).toISOString(),
        amount: new Intl.NumberFormat('en-IE', { currency: payment.currency, style: 'currency' }).format(payment.amount_cents / 100),
        source: SOURCE_LABELS[payment.source] ?? payment.source,
        status: payment.refund_status === 'succeeded' ? 'Refunded' : payment.refund_status ? payment.refund_status.replaceAll('_', ' ') : 'Paid',
    }));
    return (
        <AdminReadOnlyTable
            columns={COLUMNS}
            dateColumn="date"
            empty="No payments have been recorded for this member."
            initialPreferences={initialPreferences}
            loading={loading}
            preferenceKey="member_payments"
            rowActions={(row) => {
                const payment = payments.find((entry) => String(entry.id) === row.id);
                return payment && payment.refund_status !== 'succeeded' && ['stripe_recurring', 'stripe_one_time'].includes(payment.source)
                    ? <RefundAction onSuccess={onSuccess} payment={payment} profileId={profileId} />
                    : '—';
            }}
            rows={rows}
            searchLabel="Search payment history"
            statusColumn="status"
        />
    );
    }
