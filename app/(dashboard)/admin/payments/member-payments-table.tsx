'use client';

import { type ColumnDef, getCoreRowModel, getPaginationRowModel, useReactTable } from '@tanstack/react-table';
import { Undo2 } from 'lucide-react';
import { DataTable } from '@/components/data-table/data-table';
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

export function MemberPaymentsTable({ loading, onSuccess, payments, profileId }: { loading?: boolean; onSuccess: () => void; payments: StripePayment[]; profileId: string })
    {
    const columns: ColumnDef<StripePayment>[] = [
        { accessorKey: 'paid_at', header: 'Date', cell: ({ row }) => formatTableDate(row.original.paid_at) },
        { accessorKey: 'amount_cents', header: 'Amount', cell: ({ row }) => new Intl.NumberFormat('en-IE', { currency: row.original.currency, style: 'currency' }).format(row.original.amount_cents / 100) },
        { accessorKey: 'source', header: 'Source', cell: ({ row }) => SOURCE_LABELS[row.original.source] ?? row.original.source },
        { accessorKey: 'refund_status', header: 'Status', cell: ({ row }) => row.original.refund_status === 'succeeded' ? 'Refunded' : row.original.refund_status ? row.original.refund_status.replaceAll('_', ' ') : 'Paid' },
        { id: 'actions', header: 'Actions', enableHiding: false, cell: ({ row }) => row.original.refund_status === 'succeeded' || !['stripe_recurring', 'stripe_one_time'].includes(row.original.source) ? '—' : <RefundAction onSuccess={onSuccess} payment={row.original} profileId={profileId} /> },
    ];
    const table = useReactTable({
        columns,
        data: payments,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getRowId: (payment) => String(payment.id),
        initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
    });
    return <DataTable emptyState="No payments have been recorded for this member." loading={loading} pageSizeOptions={[10, 25, 50, 100]} table={table} />;
    }
