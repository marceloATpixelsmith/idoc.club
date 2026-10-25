'use client';

import { AdminReadOnlyTable, type ReadOnlyRow } from '@/components/admin/admin-read-only-table';
import type { TablePreferenceState } from '@/lib/admin/table-preferences';
import { IgnoreFindings, type IgnoreState } from './ignore-findings';

type IgnoreAction = (state: IgnoreState, formData: FormData) => Promise<IgnoreState>;

/** The findings table with its one selection-bar action: Ignore. Defined on the client because a render callback cannot be passed from the server page
 * across the client boundary; only the serializable rows and the Server Action cross it. */
export function ReconciliationFindingsTable({ ignoreAction, initialPreferences, rows }: { ignoreAction?: IgnoreAction; initialPreferences?: TablePreferenceState | null; rows: ReadOnlyRow[] }) {
  return (
    <AdminReadOnlyTable
      bulkActions={ignoreAction ? ({ clearSelection, selected }) => <IgnoreFindings action={ignoreAction} clearSelection={clearSelection} selected={selected} /> : undefined}
      columns={[{ id: 'category', label: 'Category' }, { id: 'kind', label: 'Type' }, { id: 'summary', label: 'Summary' }, { id: 'stripeId', label: 'Stripe ID' }, { id: 'member', label: 'Member' }, { id: 'detected', label: 'Detected' }]}
      dateColumn="detected"
      empty="No findings from the last run."
      initialPreferences={initialPreferences}
      preferenceKey="reconciliation_findings"
      filterColumns={['kind']}
      rows={rows}
      searchLabel="Search reconciliation findings"
      statusColumn="category"
      tableType="reconciliation"
    />
  );
}
