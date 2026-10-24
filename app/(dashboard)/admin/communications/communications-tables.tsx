'use client';

import { AdminReadOnlyTable, type ReadOnlyRow } from '@/components/admin/admin-read-only-table';

/** The Communications lists on the shared administrator report table (search, sort, column filters, date range, pagination). Rows are plain strings so they cross the server/client boundary. */
export function SentNoticesTable({ rows }: { rows: ReadOnlyRow[] }) {
  return (
    <AdminReadOnlyTable
      columns={[{ id: 'sent', label: 'Sent' }, { id: 'notice', label: 'Notice' }, { id: 'member', label: 'Member' }, { id: 'email', label: 'Email' }, { id: 'queue', label: 'Queue' }, { id: 'brevo', label: 'Brevo log' }]}
      dateColumn="sent"
      empty="No renewal notices were sent in this period."
      filterColumns={['notice', 'brevo']}
      rows={rows}
      searchLabel="Search renewal notices"
      statusColumn="queue"
    />
  );
}

export function UpcomingNoticesTable({ rows }: { rows: ReadOnlyRow[] }) {
  return (
    <AdminReadOnlyTable
      columns={[{ id: 'goesOut', label: 'Goes out' }, { id: 'notice', label: 'Notice' }, { id: 'member', label: 'Member' }, { id: 'email', label: 'Email' }, { id: 'target', label: 'Renewal / expiry date' }]}
      dateColumn="goesOut"
      empty="No renewal notices are scheduled for this period."
      filterColumns={['notice']}
      rows={rows}
      searchLabel="Search upcoming notices"
      statusColumn="notice"
    />
  );
}
