'use client';

import { AdminReadOnlyTable, type ReadOnlyRow } from '@/components/admin/admin-read-only-table';
import { IgnoreFindings, type IgnoreState } from './ignore-findings';

type IgnoreAction = (state: IgnoreState, formData: FormData) => Promise<IgnoreState>;

/** The findings table with its one selection-bar action: Ignore. Defined on the client because a render callback cannot be passed from the server page
 * across the client boundary; only the serializable rows and the Server Action cross it. */
export function ReconciliationFindingsTable({ ignoreAction, rows }: { ignoreAction?: IgnoreAction; rows: ReadOnlyRow[] }) {
  return (
    <AdminReadOnlyTable
      bulkActions={ignoreAction ? ({ clearSelection, selected }) => <IgnoreFindings action={ignoreAction} clearSelection={clearSelection} selected={selected} /> : undefined}
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
