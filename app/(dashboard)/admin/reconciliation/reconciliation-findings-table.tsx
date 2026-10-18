'use client';

import { AdminReadOnlyTable, type ReadOnlyRow } from '@/components/admin/admin-read-only-table';
import { DeleteSelectedCustomers } from './delete-selected-customers';
import { MarkFindingsHandled, type MarkHandledState } from './mark-findings-handled';
import type { CleanupCustomersState } from './cleanup-customers-form';

type Action = (state: CleanupCustomersState, formData: FormData) => Promise<CleanupCustomersState>;

/** The findings table with its Type-specific selection-bar actions. Defined on the client because a render callback cannot be passed
 * from the server page across the client boundary; only the serializable rows and the Server Action cross it. */
type HandledAction = (state: MarkHandledState, formData: FormData) => Promise<MarkHandledState>;

export function ReconciliationFindingsTable({ cleanupAction, handledAction, rows }: { cleanupAction?: Action; handledAction?: HandledAction; rows: ReadOnlyRow[] }) {
  return (
    <AdminReadOnlyTable
      bulkActions={cleanupAction || handledAction ? ({ clearSelection, selected }) => <>
        {cleanupAction ? <DeleteSelectedCustomers action={cleanupAction} clearSelection={clearSelection} selected={selected} /> : null}
        {handledAction ? <MarkFindingsHandled action={handledAction} clearSelection={clearSelection} selected={selected} /> : null}
      </> : undefined}
      columns={[{ id: 'category', label: 'Category' }, { id: 'kind', label: 'Type' }, { id: 'summary', label: 'Summary' }, { id: 'stripeId', label: 'Stripe ID' }, { id: 'member', label: 'Member' }, { id: 'detected', label: 'Detected' }]}
      dateColumn="detected"
      empty="No findings from the last run."
      filterColumns={['kind']}
      rows={rows}
      searchLabel="Search reconciliation findings"
      statusColumn="category"
      tableType="reconciliation"
    />
  );
}
