'use client';

import { AdminReadOnlyTable, type ReadOnlyRow } from '@/components/admin/admin-read-only-table';
import { DeleteSelectedCustomers } from './delete-selected-customers';
import type { CleanupCustomersState } from './cleanup-customers-form';

type Action = (state: CleanupCustomersState, formData: FormData) => Promise<CleanupCustomersState>;

/** The findings table with its Type-specific selection-bar actions. Defined on the client because a render callback cannot be passed
 * from the server page across the client boundary; only the serializable rows and the Server Action cross it. */
export function ReconciliationFindingsTable({ cleanupAction, rows }: { cleanupAction?: Action; rows: ReadOnlyRow[] }) {
  return (
    <AdminReadOnlyTable
      bulkActions={cleanupAction ? ({ clearSelection, selected }) => <DeleteSelectedCustomers action={cleanupAction} clearSelection={clearSelection} selected={selected} /> : undefined}
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
